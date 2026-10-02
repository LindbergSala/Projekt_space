import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright-core"

import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"
import { startLocalServer } from "./browser-helpers.mjs"

const STARTING_MATERIALS = 9_007_199_254_740_993n
const START_BUTTON = "Recruit Line Infantry"
const COLLECT_BUTTON = "Collect recruits"

async function databaseTime(prisma) {
  const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
  return currentTime
}

async function planetSnapshot(prisma, planetId) {
  const where = { planetId }
  const orderBy = { id: "asc" }
  return {
    planet: await prisma.planet.findUnique({ where: { id: planetId } }),
    constructions: await prisma.planetConstruction.findMany({ where, orderBy }),
    recruitment: await prisma.planetRecruitment.findMany({ where, orderBy }),
    materials: await prisma.planetMaterialTransaction.findMany({ where, orderBy }),
    units: await prisma.planetUnitStack.findMany({ where, orderBy: { unitKey: "asc" } }),
    unitLedger: await prisma.planetUnitTransaction.findMany({ where, orderBy }),
  }
}

async function openPlanet(context, server, planetId) {
  const page = await context.newPage()
  await page.goto(`${server.origin}/planets/${planetId}`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("heading", { name: "Recruitment", exact: true }).waitFor()
  return page
}

async function setRenderedOperation(page, operationKey) {
  // Only copy an intent UUID that a real server-rendered form already supplied.
  // The browser still submits the actual Next.js form and framework metadata.
  await page.locator('.recruitment-start-form input[name="operationKey"]').evaluate((input, value) => {
    input.value = value
  }, operationKey)
}

async function submitRecruitment(page, buttonName, javaScriptEnabled, status) {
  const button = page.getByRole("button", { name: buttonName, exact: true })
  const form = button.locator("..")
  const metadataCount = await form.locator('input[name^="$ACTION_"]').count()
  // Native submissions require the SSR transport fields. A hydrated form
  // replaced by an RSC navigation can instead identify its action exclusively
  // through the actual Next-Action request header.
  if (!javaScriptEnabled) {
    assert.ok(metadataCount > 0, "a native recruitment form must contain framework metadata")
  }
  const pathname = new URL(page.url()).pathname
  const pendingResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === pathname)
  await button.click()
  const response = await pendingResponse
  assert.ok(response.status() < 400, `Recruitment POST returned ${response.status()}`)
  assert.equal(Boolean(response.request().headers()["next-action"]), javaScriptEnabled)
  if (metadataCount > 0) assert.match(response.request().postData(), /\$ACTION_/u)
  await page.waitForURL((url) => url.searchParams.get("recruitment") === status)
  await page.waitForLoadState("networkidle")
  await page.locator(".recruitment-feedback").waitFor()
  return response.status()
}

async function assertReadOnlyViews({ context, page, server, prisma, planetId, status, quantity, forces }) {
  const before = await planetSnapshot(prisma, planetId)
  await page.getByRole("button", { name: "Refresh recruitment status", exact: true }).click()
  await page.waitForLoadState("networkidle")
  assert.equal(await page.getByLabel("Line Infantry quantity", { exact: true }).innerText(), forces)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "the mobile planet page must not overflow horizontally")
  const overview = await context.newPage()
  await overview.goto(`${server.origin}/civilization`)
  await overview.waitForLoadState("networkidle")
  const card = overview.locator(".command-center-planet").filter({
    has: overview.getByRole("heading", { name: "Synthetic Recruitment Planet", exact: true }),
  })
  assert.equal(await overview.getByLabel("Line Infantry total quantity", { exact: true }).innerText(), forces)
  assert.equal(await card.locator("dl > div").filter({
    has: overview.getByText("Ground forces", { exact: true }),
  }).locator("dd").innerText(), forces)
  if (status) {
    assert.match(await card.locator(".command-center-recruitment").innerText(),
      new RegExp(`${quantity} Line Infantry[\\s\\S]*${status}`, "u"))
    assert.equal(await card.getByRole("link", { name: "Open recruitment", exact: true }).count(), 1)
  } else {
    assert.equal(await card.locator(".command-center-recruitment").count(), 0)
  }
  assert.ok(await overview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await overview.close()
  assert.deepEqual(await planetSnapshot(prisma, planetId), before,
    "detail and Command Center GETs must not mutate orders, balances, stacks, construction or ledgers")
}

async function awaitOfflineCompletion({ context, prisma, completesAt }) {
  for (const page of context.pages()) await page.close()
  assert.equal(context.pages().length, 0)
  const deadline = Date.now() + 330_000
  let nextProgress = 0
  while (true) {
    const now = await databaseTime(prisma)
    const remaining = completesAt.getTime() - now.getTime()
    if (remaining <= 0) {
      console.log("The real 300-second recruitment has reached its saved PostgreSQL finish time; no browser pages were open.")
      return now
    }
    assert.ok(Date.now() < deadline, "real five-minute recruitment exceeded the wait budget")
    assert.equal(context.pages().length, 0, "all browser pages must stay closed during the real wait")
    if (Date.now() >= nextProgress) {
      console.log(`Real offline recruitment: ${Math.ceil(remaining / 1000)} seconds remain by PostgreSQL; browser pages closed.`)
      nextProgress = Date.now() + 30_000
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, remaining + 25)))
  }
}

// Fixture time travel is limited to this test's synthetic order and preserves
// its entire accepted duration. It does not alter product rules or add a hook.
async function moveSyntheticOrderIntoPast(prisma, order) {
  const now = await databaseTime(prisma)
  const shift = order.completesAt.getTime() - now.getTime() + 1_000
  assert.ok(shift > 0)
  return prisma.planetRecruitment.update({
    where: { id: order.id },
    data: {
      startedAt: new Date(order.startedAt.getTime() - shift),
      completesAt: new Date(order.completesAt.getTime() - shift),
    },
  })
}

test("real recruitment forms pay, wait offline and collect exactly once", {
  skip: process.env.RUN_MATERIALS_BROWSER_TESTS !== "1",
  timeout: 600_000,
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
    await t.test(javaScriptEnabled ? "hydrated recruitment and collection" : "native recruitment and collection", async () => {
      const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 390, height: 844 } })
      const errors = []
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("console", (message) => {
          if (message.location().url === `${server.origin}/favicon.ico` && message.text().includes("404")) return
          if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`)
        })
      })
      const email = `recruitment-browser-${randomUUID()}@example.invalid`
      const planetId = randomUUID()
      let ownerId
      try {
        const signup = await context.request.post(`${server.origin}/api/auth/sign-up/email`, {
          headers: { origin: server.authOrigin },
          data: { name: "Synthetic Recruitment Player", email, password: randomUUID() + randomUUID() },
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
          id: planetId, ownerId, name: "Synthetic Recruitment Planet", materials: STARTING_MATERIALS,
        } })
        let page = await openPlanet(context, server, planetId)
        assert.match(await page.locator(".recruitment-blocked").innerText(), /Barracks/u)
        assert.equal(await page.getByRole("button", { name: START_BUTTON, exact: true }).count(), 0)
        const now = await databaseTime(prisma)
        const barracks = await prisma.planetConstruction.create({ data: {
          id: randomUUID(), planetId, buildingKey: "barracks", fromLevel: 0, targetLevel: 1,
          materialsCost: 20n, startedAt: now, completesAt: new Date(now.getTime() + 120_000),
        } })
        await page.reload()
        await page.waitForLoadState("networkidle")
        assert.match(await page.locator(".recruitment-blocked").innerText(), /Barracks/u)
        assert.equal(await page.getByRole("button", { name: START_BUTTON, exact: true }).count(), 0,
          "an unfinished Barracks must not unlock the start form")
        await prisma.planetConstruction.update({ where: { id: barracks.id }, data: {
          // Keep Barracks completed before even the later 50-minute synthetic
          // recruitment interval, while retaining its real two-minute duration.
          startedAt: new Date(now.getTime() - 3_720_000), completesAt: new Date(now.getTime() - 3_600_000),
        } })
        await page.reload()
        await page.waitForLoadState("networkidle")
        assert.equal(await page.getByRole("button", { name: START_BUTTON, exact: true }).count(), 1)
        assert.match(await page.locator(".planet-recruitment").innerText(), /10 Materials[\s\S]*5 minutes/u)

        const original = await planetSnapshot(prisma, planetId)
        assert.ok(await page.locator('.recruitment-start-form input[name^="$ACTION_"]').count() > 0,
          "the initial SSR recruitment form must contain real framework metadata")
        const operationKey = await page.locator('.recruitment-start-form input[name="operationKey"]').inputValue()
        const retryPage = await openPlanet(context, server, planetId)
        await setRenderedOperation(retryPage, operationKey)
        const busyPage = await openPlanet(context, server, planetId)
        const startStatus = await submitRecruitment(page, START_BUTTON, javaScriptEnabled, "started")
        const started = await planetSnapshot(prisma, planetId)
        assert.equal(started.recruitment.length, 1)
        const order = started.recruitment[0]
        assert.equal(order.unitKey, "line-infantry")
        assert.equal(order.quantity, 1n)
        assert.equal(order.materialsCost, 10n)
        assert.equal(order.completesAt.getTime() - order.startedAt.getTime(), 300_000)
        assert.equal(order.collectedAt, null)
        assert.equal(started.planet.materials, STARTING_MATERIALS - 10n)
        assert.deepEqual(started.planet.materialsProductionCursor, original.planet.materialsProductionCursor)
        assert.equal(started.planet.materialsProductionRemainder, original.planet.materialsProductionRemainder)
        assert.equal(started.materials.length, 1)
        assert.equal(started.materials[0].delta, -10n)
        assert.equal(started.materials[0].balanceAfter, STARTING_MATERIALS - 10n)
        assert.equal(started.units.length, 0)
        assert.equal(started.unitLedger.length, 0)
        assert.match(await page.locator(".recruitment-order").innerText(), /Recruiting[\s\S]*1 Line Infantry[\s\S]*5 minutes/u)
        assert.equal(await page.getByRole("button", { name: COLLECT_BUTTON, exact: true }).count(), 0)
        await submitRecruitment(retryPage, START_BUTTON, javaScriptEnabled, "start-replayed")
        assert.deepEqual(await planetSnapshot(prisma, planetId), started)
        await submitRecruitment(busyPage, START_BUTTON, javaScriptEnabled, "busy")
        assert.deepEqual(await planetSnapshot(prisma, planetId), started)

        const constructionResponse = page.waitForResponse((response) =>
          response.request().method() === "POST" && new URL(response.url()).pathname === `/planets/${planetId}`)
        await page.getByRole("button", { name: "Upgrade Planetary Command to level 2", exact: true }).click()
        assert.ok((await constructionResponse).status() < 400)
        await page.waitForURL((url) => url.searchParams.get("construction") === "started")
        await page.waitForLoadState("networkidle")
        const parallel = await planetSnapshot(prisma, planetId)
        assert.equal(parallel.planet.materials, STARTING_MATERIALS - 60n)
        assert.equal(parallel.recruitment.length, 1)
        assert.equal(parallel.constructions.length, 2)
        assert.match(await page.locator(".infrastructure-active-work").innerText(), /Planetary Command/u)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, status: "Recruiting", quantity: "1", forces: "0" })

        const realWait = server.mode === "production" && javaScriptEnabled
        if (realWait) {
          console.log("Starting the real five-minute offline test of one browser-ordered Line Infantry.")
          const completedAt = await awaitOfflineCompletion({ context, prisma, completesAt: order.completesAt })
          assert.ok(completedAt.getTime() >= order.completesAt.getTime())
          assert.deepEqual(await planetSnapshot(prisma, planetId), parallel,
            "passing the saved finish time offline must not deliver units or mutate any gameplay row")
          page = await openPlanet(context, server, planetId)
        } else {
          await moveSyntheticOrderIntoPast(prisma, order)
          await page.reload()
          await page.waitForLoadState("networkidle")
        }
        assert.match(await page.locator(".recruitment-order").innerText(), /Ready to collect/u)
        assert.equal(await page.getByRole("button", { name: START_BUTTON, exact: true }).count(), 0)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, status: "Ready to collect", quantity: "1", forces: "0" })
        if (javaScriptEnabled && process.env.RECRUITMENT_SCREENSHOT_PATH) {
          await page.locator(".planet-recruitment").screenshot({ path: process.env.RECRUITMENT_SCREENSHOT_PATH })
        }
        const collectRetry = await openPlanet(context, server, planetId)
        const collectStatus = await submitRecruitment(page, COLLECT_BUTTON, javaScriptEnabled, "collected")
        const collected = await planetSnapshot(prisma, planetId)
        assert.equal(collected.planet.materials, STARTING_MATERIALS - 60n)
        assert.equal(collected.materials.length, 2)
        assert.equal(collected.units.length, 1)
        assert.equal(collected.units[0].unitKey, "line-infantry")
        assert.equal(collected.units[0].quantity, 1n)
        assert.equal(collected.unitLedger.length, 1)
        assert.equal(collected.unitLedger[0].delta, 1n)
        assert.equal(collected.unitLedger[0].quantityAfter, 1n)
        assert.ok(collected.recruitment[0].collectedAt >= collected.recruitment[0].completesAt)
        if (realWait) assert.deepEqual(collected.recruitment[0].completesAt, order.completesAt)
        await submitRecruitment(collectRetry, COLLECT_BUTTON, javaScriptEnabled, "collect-replayed")
        assert.deepEqual(await planetSnapshot(prisma, planetId), collected)
        await page.reload()
        await page.waitForLoadState("networkidle")
        assert.equal(await page.getByLabel("Line Infantry quantity", { exact: true }).innerText(), "1")
        assert.match(await page.locator(".unit-history").innerText(), /Line Infantry[\s\S]*\+1[\s\S]*Resulting quantity: 1/u)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, status: null, forces: "1" })

        // Reuse the first rendered intent after collection: it must still return
        // the paid order, even though a brand-new order is now allowed.
        await setRenderedOperation(page, operationKey)
        await submitRecruitment(page, START_BUTTON, javaScriptEnabled, "start-replayed")
        assert.deepEqual(await planetSnapshot(prisma, planetId), collected)

        await page.getByLabel("Number of units", { exact: true }).fill("10")
        const tenBusy = await openPlanet(context, server, planetId)
        await tenBusy.getByLabel("Number of units", { exact: true }).fill("10")
        await submitRecruitment(page, START_BUTTON, javaScriptEnabled, "started")
        const tenStarted = await planetSnapshot(prisma, planetId)
        const tenOrder = tenStarted.recruitment.find((entry) => entry.collectedAt === null)
        assert.equal(tenOrder.quantity, 10n)
        assert.equal(tenOrder.materialsCost, 100n)
        assert.equal(tenOrder.completesAt.getTime() - tenOrder.startedAt.getTime(), 3_000_000)
        assert.equal(tenStarted.planet.materials, STARTING_MATERIALS - 160n)
        assert.equal(tenStarted.materials.length, 3)
        assert.equal(tenStarted.units[0].quantity, 1n)
        assert.equal(tenStarted.unitLedger.length, 1)
        assert.match(await page.locator(".recruitment-order").innerText(), /10 Line Infantry[\s\S]*100 Materials[\s\S]*50 minutes/u)
        await moveSyntheticOrderIntoPast(prisma, tenOrder)
        await page.reload()
        await page.waitForLoadState("networkidle")
        const tenReady = await planetSnapshot(prisma, planetId)
        await submitRecruitment(tenBusy, START_BUTTON, javaScriptEnabled, "busy")
        assert.deepEqual(await planetSnapshot(prisma, planetId), tenReady,
          "a ready but uncollected batch still blocks a new real form submission")
        await assertReadOnlyViews({ context, page, server, prisma, planetId, status: "Ready to collect", quantity: "10", forces: "1" })
        await submitRecruitment(page, COLLECT_BUTTON, javaScriptEnabled, "collected")
        const finished = await planetSnapshot(prisma, planetId)
        assert.equal(finished.planet.materials, STARTING_MATERIALS - 160n)
        assert.equal(finished.materials.length, 3)
        assert.equal(finished.units[0].quantity, 11n)
        assert.equal(finished.unitLedger.length, 2)
        assert.ok(finished.unitLedger.some((entry) => entry.delta === 10n && entry.quantityAfter === 11n))
        assert.equal(finished.recruitment.filter((entry) => entry.collectedAt !== null).length, 2)
        await assertReadOnlyViews({ context, page, server, prisma, planetId, status: null, forces: "11" })
        assert.deepEqual(errors, [], "recruitment must have no browser runtime or console errors")
        assert.equal(/\b(?:PrismaClientKnownRequestError|PrismaClientUnknownRequestError|UnhandledPromiseRejection)\b/u.test(server.output()), false,
          "the local server must not report an unhandled database or promise error")
        console.log(`${server.mode}: ${javaScriptEnabled ? "Hydrated" : "Native"} recruitment POST ${startStatus}, collection POST ${collectStatus}; exact -10/-100 Materials and +1/+10 units, parallel construction, busy/ready gating, retries, read-only views and mobile layout verified${realWait ? "; real 300-second offline interval" : "; canonical-duration time fixtures"}.`)
      } finally {
        await context.close()
        await prisma.planetRecruitment.deleteMany({ where: { planetId } })
        await prisma.planetConstruction.deleteMany({ where: { planetId } })
        await prisma.planetUnitTransaction.deleteMany({ where: { planetId } })
        await prisma.planetUnitStack.deleteMany({ where: { planetId } })
        await prisma.planetMaterialTransaction.deleteMany({ where: { planetId } })
        await prisma.planet.deleteMany({ where: { id: planetId } })
        await prisma.user.deleteMany({ where: { email, ...(ownerId ? { id: ownerId } : {}) } })
      }
    })
  }
})
