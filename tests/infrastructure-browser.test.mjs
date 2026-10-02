import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright-core"

import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"
import { startLocalServer } from "./browser-helpers.mjs"

const STARTING_MATERIALS = 9_007_199_254_740_993n
const EXTRACTOR_BUTTON = "Build Materials Extractor"
const COMMAND_BUTTON = "Upgrade Planetary Command to level 2"

async function databaseTime(prisma) {
  const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
  return currentTime
}

async function planetSnapshot(prisma, planetId) {
  return {
    planet: await prisma.planet.findUnique({ where: { id: planetId } }),
    constructions: await prisma.planetConstruction.findMany({ where: { planetId }, orderBy: { id: "asc" } }),
    ledger: await prisma.planetMaterialTransaction.findMany({ where: { planetId }, orderBy: { id: "asc" } }),
  }
}

async function openPlanet(context, server, planetId) {
  const page = await context.newPage()
  await page.goto(`${server.origin}/planets/${planetId}`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("heading", { name: "Infrastructure", exact: true }).waitFor()
  return page
}

async function reuseRenderedOperation(source, retry, buttonName) {
  const sourceForm = source.getByRole("button", { name: buttonName, exact: true }).locator("..")
  const retryForm = retry.getByRole("button", { name: buttonName, exact: true }).locator("..")
  const operationKey = await sourceForm.locator('input[name="operationKey"]').inputValue()
  // A fresh render normally creates a different intent. Reuse only the original
  // rendered intent UUID to simulate a lost-response retry. Both submissions
  // still click real Next.js forms, with their real metadata and browser POSTs;
  // no FormData body or action identifier is fabricated by the test.
  await retryForm.locator('input[name="operationKey"]').evaluate((input, value) => {
    input.value = value
  }, operationKey)
}

async function submitConstruction(page, name, javaScriptEnabled, status = "started") {
  const button = page.getByRole("button", { name, exact: true })
  const form = button.locator("..")
  assert.ok(await form.locator('input[name^="$ACTION_"]').count() > 0,
    "real rendered construction forms must contain framework metadata")
  const pathname = new URL(page.url()).pathname
  const pendingResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === pathname)
  await button.click()
  const response = await pendingResponse
  assert.ok(response.status() < 400, `Construction POST returned ${response.status()}`)
  assert.equal(Boolean(response.request().headers()["next-action"]), javaScriptEnabled)
  assert.match(response.request().postData(), /\$ACTION_/u,
    "the browser submission must carry actual framework metadata")
  await page.waitForURL((url) => url.searchParams.get("construction") === status)
  await page.waitForLoadState("networkidle")
  await page.locator(".construction-feedback").waitFor()
  return response.status()
}

async function assertLevels(page, commandLevel, extractorLevel, rate) {
  assert.match(await page.locator('[data-building-key="planetary-command"]').innerText(),
    new RegExp(`Level ${commandLevel} / 5`, "u"))
  assert.match(await page.locator('[data-building-key="materials-extractor"]').innerText(),
    new RegExp(`Level ${extractorLevel} / 5`, "u"))
  assert.equal(await page.locator(".planet-resources dl > div").filter({
    has: page.getByText("Production", { exact: true }),
  }).locator("dd").innerText(), `${rate} / hour`)
  assert.match(await page.locator('[data-building-key="materials-extractor"]').innerText(),
    new RegExp(`Current production: ${rate} Materials / hour`, "u"))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "the 390px mobile page must not overflow horizontally")
}

async function assertReadOnlyViews({ context, page, server, prisma, planetId, rate, activeName = null }) {
  const before = await planetSnapshot(prisma, planetId)
  await page.getByRole("button", { name: "Refresh status", exact: true }).click()
  await page.waitForLoadState("networkidle")
  const overview = await context.newPage()
  await overview.goto(`${server.origin}/civilization`)
  await overview.waitForLoadState("networkidle")
  const card = overview.locator(".command-center-planet").filter({
    has: overview.getByRole("heading", { name: "Synthetic Infrastructure Planet", exact: true }),
  })
  assert.equal(await card.locator("dl > div").filter({
    has: overview.getByText("Production", { exact: true }),
  }).locator("dd").innerText(), `${rate} / hour`)
  if (activeName) {
    assert.match(await card.locator(".command-center-construction").innerText(),
      new RegExp(activeName, "u"))
  } else {
    assert.equal(await card.locator(".command-center-construction-idle").innerText(),
      "No construction in progress.")
  }
  assert.ok(await overview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await overview.close()
  assert.deepEqual(await planetSnapshot(prisma, planetId), before,
    "detail refresh and Command Center GET must not mutate balance, cursor, remainder, construction or ledger")
}

async function awaitOfflineCompletion({ context, prisma, completesAt }) {
  for (const page of context.pages()) await page.close()
  assert.equal(context.pages().length, 0, "no browser page may remain open during the real wait")
  const deadline = Date.now() + 75_000
  while (true) {
    const now = await databaseTime(prisma)
    if (now.getTime() >= completesAt.getTime()) return now
    assert.ok(Date.now() < deadline, "the real one-minute build must finish within the local wait budget")
    await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, completesAt.getTime() - now.getTime() + 25)))
    assert.equal(context.pages().length, 0)
  }
}

// Long progression tests change only synthetic persisted timestamps. Every
// canonical duration, ordering and relative gap is retained; product timings
// are never shortened. The ledger and balance remain the real form results.
async function moveSyntheticHistoryIntoPast(prisma, planetId) {
  const rows = await prisma.planetConstruction.findMany({ where: { planetId } })
  const now = await databaseTime(prisma)
  const lastCompletion = Math.max(...rows.map((row) => row.completesAt.getTime()))
  const shift = lastCompletion - now.getTime() + 2_000
  assert.ok(shift > 0)
  await prisma.$transaction(rows.map((row) => prisma.planetConstruction.update({
    where: { id: row.id },
    data: {
      startedAt: new Date(row.startedAt.getTime() - shift),
      completesAt: new Date(row.completesAt.getTime() - shift),
    },
  })))
}

test("real infrastructure forms build and upgrade with authoritative completion", {
  skip: process.env.RUN_MATERIALS_BROWSER_TESTS !== "1",
  timeout: 240_000,
}, async (t) => {
  const databaseUrl = process.env.DATABASE_URL
  parseCompatibleDatabaseUrl(databaseUrl)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  t.after(() => prisma.$disconnect())
  const [identity] = await prisma.$queryRaw`
    SELECT current_database() AS "database", current_user AS "role",
      rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
      has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreateSchemaObjects"
      FROM pg_roles WHERE rolname = current_user
  `
  assert.deepEqual(identity, {
    database: "projekt_space_dev", role: "projekt_space_app",
    rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolbypassrls: false, canCreateSchemaObjects: false,
  })

  const server = await startLocalServer(databaseUrl, t)
  const browser = await chromium.launch({
    ...(process.env.CLAIM_BROWSER_EXECUTABLE
      ? { executablePath: process.env.CLAIM_BROWSER_EXECUTABLE }
      : { channel: "chrome" }),
    headless: true,
  })
  t.after(() => browser.close())

  for (const javaScriptEnabled of [true, false]) {
    await t.test(javaScriptEnabled ? "hydrated build and upgrade" : "native build and upgrade", async () => {
      const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 390, height: 844 } })
      const errors = []
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("console", (message) => {
          if (message.location().url === `${server.origin}/favicon.ico` && message.text().includes("404")) return
          if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`)
        })
      })
      const email = `infrastructure-browser-${randomUUID()}@example.invalid`
      const planetId = randomUUID()
      let ownerId
      try {
        const signup = await context.request.post(`${server.origin}/api/auth/sign-up/email`, {
          headers: { origin: server.authOrigin },
          data: { name: "Synthetic Infrastructure Player", email, password: randomUUID() + randomUUID() },
        })
        assert.equal(signup.status(), 200)
        ownerId = (await signup.json()).user.id
        const cookie = (await context.cookies()).find((entry) => entry.name.endsWith("better-auth.session_token"))
        assert.ok(cookie)
        assert.equal(cookie.httpOnly, true)
        assert.equal(cookie.sameSite, "Lax")
        assert.equal(cookie.secure, server.mode === "production")
        if (server.mode === "production") assert.ok(cookie.name.startsWith("__Secure-"))
        await prisma.user.update({ where: { id: ownerId }, data: { factionKey: "orthevan-directorate" } })
        await prisma.planet.create({ data: {
          id: planetId, ownerId, name: "Synthetic Infrastructure Planet", materials: STARTING_MATERIALS,
        } })

        let page = await openPlanet(context, server, planetId)
        await assertLevels(page, 1, 0, "11")
        assert.match(await page.locator(".infrastructure-production-notice").innerText(),
          /Unit recruitment and ship production are not available yet/u)
        assert.equal(await page.locator(".infrastructure-building").count(), 5)
        const original = await planetSnapshot(prisma, planetId)
        assert.equal(original.constructions.length, 0)
        assert.equal(original.planet.materialsProductionRemainder, 0n)
        const beforeRetry = await openPlanet(context, server, planetId)
        const busyPage = await openPlanet(context, server, planetId)
        const realWait = server.mode === "development" && javaScriptEnabled
        const completedRetry = realWait ? null : await openPlanet(context, server, planetId)
        await reuseRenderedOperation(page, beforeRetry, EXTRACTOR_BUTTON)
        if (completedRetry) await reuseRenderedOperation(page, completedRetry, EXTRACTOR_BUTTON)

        const buildStatus = await submitConstruction(page, EXTRACTOR_BUTTON, javaScriptEnabled)
        const built = await planetSnapshot(prisma, planetId)
        assert.equal(built.constructions.length, 1)
        const extractor = built.constructions[0]
        assert.equal(extractor.buildingKey, "materials-extractor")
        assert.equal(extractor.fromLevel, 0)
        assert.equal(extractor.targetLevel, 1)
        assert.equal(extractor.materialsCost, 10n)
        assert.equal(extractor.completesAt.getTime() - extractor.startedAt.getTime(), 60_000)
        assert.equal(built.planet.materials, STARTING_MATERIALS - 10n)
        assert.equal(built.ledger.length, 1)
        assert.equal(built.ledger[0].delta, -10n)
        assert.equal(built.ledger[0].balanceAfter, STARTING_MATERIALS - 10n)
        assert.deepEqual(built.planet.materialsProductionCursor, original.planet.materialsProductionCursor)
        assert.equal(built.planet.materialsProductionRemainder, 0n)
        await assertLevels(page, 1, 0, "11")
        assert.match(await page.locator(".infrastructure-active-work").innerText(), /Building Materials Extractor/u)

        await submitConstruction(beforeRetry, EXTRACTOR_BUTTON, javaScriptEnabled, "replayed")
        assert.match(await beforeRetry.locator(".construction-feedback").innerText(), /No additional Materials/u)
        assert.deepEqual(await planetSnapshot(prisma, planetId), built)
        await submitConstruction(busyPage, "Build Barracks", javaScriptEnabled, "busy")
        assert.match(await busyPage.locator(".construction-feedback").innerText(), /Another construction is already in progress/u)
        assert.deepEqual(await planetSnapshot(prisma, planetId), built)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, rate: "11", activeName: "Materials Extractor" })
        assert.ok((await databaseTime(prisma)).getTime() < extractor.completesAt.getTime(),
          "the real extractor must still be incomplete before its authoritative finish time")

        if (realWait) {
          console.log("Waiting for the real 60-second Extractor with every browser page closed.")
          const completedAt = await awaitOfflineCompletion({ context, prisma, completesAt: extractor.completesAt })
          assert.ok(completedAt >= extractor.completesAt)
          assert.deepEqual(await planetSnapshot(prisma, planetId), built,
            "offline completion must require no worker or completion mutation")
          page = await openPlanet(context, server, planetId)
        } else {
          await moveSyntheticHistoryIntoPast(prisma, planetId)
          await page.reload()
          await page.waitForLoadState("networkidle")
        }

        await assertLevels(page, 1, 1, "22")
        assert.equal(await page.locator(".infrastructure-active-work").count(), 0)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, rate: "22" })
        const completed = await planetSnapshot(prisma, planetId)
        if (realWait) assert.deepEqual(completed.constructions[0].completesAt, extractor.completesAt)
        if (completedRetry) {
          await submitConstruction(completedRetry, EXTRACTOR_BUTTON, javaScriptEnabled, "replayed")
          assert.deepEqual(await planetSnapshot(prisma, planetId), completed,
            "a stale build form must not debit or start an upgrade after completion")
        }

        const upgradeRetry = await openPlanet(context, server, planetId)
        await reuseRenderedOperation(page, upgradeRetry, COMMAND_BUTTON)
        const upgradeStatus = await submitConstruction(page, COMMAND_BUTTON, javaScriptEnabled)
        const upgrading = await planetSnapshot(prisma, planetId)
        assert.equal(upgrading.constructions.length, 2)
        const command = upgrading.constructions.find((row) => row.buildingKey === "planetary-command")
        assert.equal(command.fromLevel, 1)
        assert.equal(command.targetLevel, 2)
        assert.equal(command.materialsCost, 50n)
        assert.equal(command.completesAt.getTime() - command.startedAt.getTime(), 1_800_000)
        assert.equal(upgrading.planet.materials, STARTING_MATERIALS - 60n)
        assert.deepEqual(upgrading.ledger.map((row) => row.delta).sort((left, right) => Number(left - right)), [-50n, -10n])
        await assertLevels(page, 1, 1, "22")
        assert.match(await page.locator(".infrastructure-active-work").innerText(), /Upgrading Planetary Command/u)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, rate: "22", activeName: "Planetary Command" })

        await moveSyntheticHistoryIntoPast(prisma, planetId)
        await page.reload()
        await page.waitForLoadState("networkidle")
        await assertLevels(page, 2, 1, "22")
        assert.equal(await page.getByRole("button", { name: "Upgrade Materials Extractor to level 2", exact: true }).count(), 1)
        const upgraded = await planetSnapshot(prisma, planetId)
        await submitConstruction(upgradeRetry, COMMAND_BUTTON, javaScriptEnabled, "replayed")
        assert.deepEqual(await planetSnapshot(prisma, planetId), upgraded,
          "a late real upgrade-form retry must not charge again or start Command level 3")
        await assertReadOnlyViews({ context, page, server, prisma, planetId, rate: "22" })
        if (javaScriptEnabled && process.env.INFRASTRUCTURE_SCREENSHOT_PATH) {
          await page.screenshot({ path: process.env.INFRASTRUCTURE_SCREENSHOT_PATH, fullPage: true })
        }
        assert.deepEqual(errors, [], "construction must have no browser runtime or console errors")
        console.log(`${server.mode}: ${javaScriptEnabled ? "Hydrated" : "Native"} Extractor POST ${buildStatus}, Command upgrade POST ${upgradeStatus}; exact -10/-50 Materials, busy feedback, stale retries, read-only completion and mobile layout verified${realWait ? "; real 60-second offline interval" : "; canonical-duration time fixtures"}.`)
      } finally {
        await context.close()
        await prisma.planetConstruction.deleteMany({ where: { planetId } })
        await prisma.planetMaterialTransaction.deleteMany({ where: { planetId } })
        await prisma.planet.deleteMany({ where: { id: planetId } })
        await prisma.user.deleteMany({ where: { email, ...(ownerId ? { id: ownerId } : {}) } })
      }
    })
  }
})
