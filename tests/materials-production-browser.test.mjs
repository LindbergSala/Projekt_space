import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright-core"

import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const HOUR = 3_600_000

async function unusedPort() {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function startLocalServer(databaseUrl, t) {
  const mode = process.env.MATERIALS_BROWSER_MODE || "development"
  assert.ok(["development", "production"].includes(mode),
    "MATERIALS_BROWSER_MODE must be development or production")
  const port = await unusedPort()
  const origin = `http://127.0.0.1:${port}`
  // Production keeps its HTTPS auth-origin policy and Secure cookies. Chromium
  // treats loopback as trustworthy; no certificate or cookie protection changes.
  // This checks next start behavior, not deployment TLS or browser auth forms.
  const authOrigin = mode === "production" ? `https://127.0.0.1:${port}` : origin
  const server = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", mode === "production" ? "start" : "dev", "--hostname", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: ROOT_DIRECTORY,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: mode,
      DATABASE_URL: databaseUrl,
      MIGRATION_DATABASE_URL: "",
      SHADOW_DATABASE_URL: "",
      BETTER_AUTH_URL: authOrigin,
      BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      VERCEL: "",
      VERCEL_ENV: "",
      VERCEL_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  server.stdout.on("data", (data) => { output += data })
  server.stderr.on("data", (data) => { output += data })
  t.after(async () => {
    if (server.exitCode !== null) return
    const exited = once(server, "exit")
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
        windowsHide: true, stdio: "ignore",
      })
    } else {
      server.kill("SIGTERM")
    }
    await exited
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local Next.js startup timed out.")), 30_000)
    const check = () => {
      if (output.includes("Ready in")) {
        clearTimeout(timer)
        resolve()
      }
    }
    server.stdout.on("data", check)
    server.once("error", () => { clearTimeout(timer); reject(new Error("Local Next.js failed to start.")) })
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Local Next.js exited before ready.")) })
  })
  return { origin, authOrigin, mode, output: () => output }
}

test("real Materials claim forms preserve exact balances and retry safety", {
  skip: process.env.RUN_MATERIALS_BROWSER_TESTS !== "1",
  timeout: 180_000,
}, async (t) => {
  // Fail before any connection or server startup if the target is not the local test database.
  const databaseUrl = process.env.DATABASE_URL
  parseCompatibleDatabaseUrl(databaseUrl)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  t.after(() => prisma.$disconnect())
  const [identity] = await prisma.$queryRaw`
    SELECT current_database() AS "database", current_user AS "role"
  `
  assert.deepEqual(identity, { database: "projekt_space_dev", role: "projekt_space_app" })

  const server = await startLocalServer(databaseUrl, t)
  const browser = await chromium.launch({
    ...(process.env.CLAIM_BROWSER_EXECUTABLE
      ? { executablePath: process.env.CLAIM_BROWSER_EXECUTABLE }
      : { channel: "chrome" }),
    headless: true,
  })
  t.after(() => browser.close())

  for (const javaScriptEnabled of [true, false]) {
    await t.test(javaScriptEnabled ? "hydrated browser" : "browser without JavaScript", async () => {
      const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 390, height: 844 } })
      const email = `claim-browser-${randomUUID()}@example.invalid`
      const password = randomUUID() + randomUUID()
      let ownerId
      const planetIds = [randomUUID(), randomUUID()]
      try {
        const entryPage = await context.newPage()
        await entryPage.goto(`${server.origin}/account`)
        assert.equal(new URL(entryPage.url()).pathname, "/login", "signed-out account must be protected")
        const signup = await context.request.post(`${server.origin}/api/auth/sign-up/email`, {
          headers: { origin: server.authOrigin },
          data: { name: "Synthetic Claim Player", email, password },
        })
        assert.equal(signup.status(), 200, "synthetic local signup must succeed")
        ownerId = (await signup.json()).user.id
        await entryPage.goto(server.origin)
        assert.equal(new URL(entryPage.url()).pathname, "/faction", "new player entry must require faction selection")

        await context.clearCookies()
        const signin = await context.request.post(`${server.origin}/api/auth/sign-in/email`, {
          headers: { origin: server.authOrigin },
          data: { email, password },
        })
        assert.equal(signin.status(), 200, "synthetic local signin must succeed")
        assert.equal((await signin.json()).user.id, ownerId)
        const sessionCookie = (await context.cookies()).find((cookie) => cookie.name.endsWith("better-auth.session_token"))
        assert.ok(sessionCookie, "authentication must issue its session cookie")
        assert.equal(sessionCookie.httpOnly, true)
        assert.equal(sessionCookie.sameSite, "Lax")
        assert.equal(sessionCookie.secure, server.mode === "production")
        if (server.mode === "production") assert.ok(sessionCookie.name.startsWith("__Secure-"))

        await prisma.user.update({ where: { id: ownerId }, data: { factionKey: "orthevan-directorate" } })
        await entryPage.goto(server.origin)
        assert.equal(new URL(entryPage.url()).pathname, "/planets", "faction player entry must require a first planet")
        const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
        const cursor = new Date(currentTime.getTime() - 19.5 * HOUR)
        const startingBalance = 9_007_199_254_740_993n
        await prisma.planet.createMany({ data: planetIds.map((id) => ({
          id, ownerId, name: "Synthetic Claim Planet", materials: startingBalance,
          materialsProductionCursor: cursor,
        })) })
        await entryPage.goto(server.origin)
        assert.equal(new URL(entryPage.url()).pathname, "/civilization", "established player entry must reach Command Center")
        await entryPage.close()

        for (const [index, route] of ["/civilization", `/planets/${planetIds[1]}`].entries()) {
          const page = await context.newPage()
          const errors = []
          page.on("pageerror", (error) => errors.push(error.message))
          page.on("console", (message) => {
            // The application has no favicon; its unrelated 404 is not a claim failure.
            if (message.location().url === `${server.origin}/favicon.ico` &&
                message.text().includes("404")) return
            if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`)
          })
          await page.goto(`${server.origin}${route}`)
          await page.waitForLoadState("networkidle")
          const form = page.locator("form.materials-production-claim").filter({
            has: page.locator(`input[name="planetId"][value="${planetIds[index]}"]`),
          })
          assert.equal(await form.getByRole("button", { name: "Claim 209 Materials", exact: true }).count(), 1)
          const metadata = await form.locator('input[name^="$ACTION_"]').count()
          assert.ok(metadata > 0, "React must have emitted real action metadata")

          // Keep an untouched second page to exercise a real stale-form retry after the claim.
          const retryPage = await context.newPage()
          await retryPage.goto(`${server.origin}${route}`)
          await retryPage.waitForLoadState("networkidle")
          const responsePromise = page.waitForResponse((response) =>
            response.request().method() === "POST" && new URL(response.url()).pathname === route)
          await form.getByRole("button", { name: "Claim 209 Materials", exact: true }).click()
          const response = await responsePromise
          const actionRequest = response.request()
          assert.equal(Boolean(actionRequest.headers()["next-action"]), javaScriptEnabled)
          assert.match(actionRequest.postData(), /\$ACTION_/u, "submit must carry real framework metadata")
          if (response.status() >= 400) {
            assert.deepEqual(await prisma.planet.findUnique({
              where: { id: planetIds[index] },
              select: { materials: true, materialsProductionCursor: true },
            }), { materials: startingBalance, materialsProductionCursor: cursor })
            assert.equal(await prisma.planetMaterialTransaction.count({
              where: { planetId: planetIds[index] },
            }), 0)
          }
          assert.ok(response.status() < 400,
            `Claim POST returned ${response.status()}; parser in server stack: ${server.output().includes("readStrictMaterialsProductionClaim")}`)
          await page.waitForLoadState("networkidle")
          await page.waitForFunction(() => !document.querySelector("[data-nextjs-dialog]"))
          const select = { materials: true, materialsProductionCursor: true }
          const after = await prisma.planet.findUnique({ where: { id: planetIds[index] }, select })
          assert.deepEqual(after, {
            materials: startingBalance + 209n,
            materialsProductionCursor: new Date(cursor.getTime() + 19 * HOUR),
          })
          const ledger = await prisma.planetMaterialTransaction.findMany({ where: { planetId: planetIds[index] } })
          assert.equal(ledger.length, 1)
          assert.equal(ledger[0].delta, 209n)
          assert.equal(ledger[0].balanceAfter, startingBalance + 209n)
          await page.locator("form.materials-production-claim").filter({
            has: page.locator(`input[name="planetId"][value="${planetIds[index]}"]`),
          }).waitFor({ state: "detached" })
          assert.ok(await page.getByText((startingBalance + 209n).toString(), { exact: true }).count() > 0,
            "the refreshed page must display the exact new balance")
          if (process.env.CLAIM_BROWSER_SCREENSHOTS === "1") {
            await page.screenshot({ path: path.join(ROOT_DIRECTORY, ".next",
              `claim-${javaScriptEnabled ? "hydrated" : "native"}-${index}.png`), fullPage: true })
          }

          const retryResponse = retryPage.waitForResponse((result) =>
            result.request().method() === "POST" && new URL(result.url()).pathname === route)
          await retryPage.locator("form.materials-production-claim").filter({
            has: retryPage.locator(`input[name="planetId"][value="${planetIds[index]}"]`),
          }).getByRole("button", { name: "Claim 209 Materials", exact: true }).click()
          assert.ok((await retryResponse).status() < 400)
          assert.deepEqual(await prisma.planet.findUnique({ where: { id: planetIds[index] }, select }), after)
          assert.deepEqual(await prisma.planetMaterialTransaction.findMany({ where: { planetId: planetIds[index] } }), ledger)
          assert.deepEqual(errors, [], "claim flow must have no browser runtime or console errors")
          console.log(`${server.mode}: ${javaScriptEnabled ? "Hydrated" : "Native"} ${route.startsWith("/planets/") ? "planet detail" : "Command Center"}: POST ${response.status()}, +209 exact Materials, one ledger row, stale retry unchanged.`)
          await retryPage.close()
          await page.close()
        }
      } finally {
        await context.close()
        await prisma.planetMaterialTransaction.deleteMany({ where: { planetId: { in: planetIds } } })
        await prisma.planet.deleteMany({ where: { id: { in: planetIds } } })
        // The generated email also scopes cleanup if signup succeeded but its response was interrupted.
        await prisma.user.deleteMany({ where: { email, ...(ownerId ? { id: ownerId } : {}) } })
      }
    })
  }
})
