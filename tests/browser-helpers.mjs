import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

async function unusedPort() {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function startLocalServer(databaseUrl, t) {
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
