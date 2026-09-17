import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const AUTH_SESSION_POLICY_URL = pathToFileURL(
  path.join(ROOT_DIRECTORY, "lib/auth-session-policy.js"),
).href

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function runModuleCheck(expression) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", expression],
    {
      cwd: ROOT_DIRECTORY,
      encoding: "utf8",
      windowsHide: true,
    },
  )
}

test("browser auth client uses the official same-origin Better Auth React client", async () => {
  const client = await source("lib/auth-client.js")

  assert.match(client, /from ["']better-auth\/react["']/)
  assert.match(client, /createAuthClient\(\)/)
  assert.doesNotMatch(client, /baseURL|token|cookie|sessionStorage|localStorage/)
})

test("account page remains server-rendered and exposes only name and email", async () => {
  const page = await source("app/account/page.js")

  assert.doesNotMatch(page, /^["']use client["']/m)
  assert.match(page, /await requireAuthenticatedUser\(\)/)
  assert.match(page, /\{user\.name\}/)
  assert.match(page, /\{user\.email\}/)
  assert.doesNotMatch(page, /sessionId|accountId|token|user\.id|console\./)
})

test("server-side session guard awaits request headers and redirects unauthenticated users", () => {
  const result = runModuleCheck(`
    const { resolveAuthenticatedUser } = await import(${JSON.stringify(AUTH_SESSION_POLICY_URL)});
    const calls = [];
    const redirectResult = await resolveAuthenticatedUser({
      getRequestHeaders: async () => {
        calls.push("headers");
        return new Headers({ "x-test": "expected" });
      },
      getSession: async ({ headers }) => {
        calls.push(headers.get("x-test"));
        return null;
      },
      redirectUnauthenticated: (destination) => {
        calls.push(destination);
        return "redirected";
      },
    });
    process.stdout.write(JSON.stringify({ calls, redirectResult }));
  `)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: ["headers", "expected", "/login"],
    redirectResult: "redirected",
  })
})

test("server-side session guard returns only public account fields", () => {
  const result = runModuleCheck(`
    const { resolveAuthenticatedUser } = await import(${JSON.stringify(AUTH_SESSION_POLICY_URL)});
    const user = await resolveAuthenticatedUser({
      getRequestHeaders: async () => new Headers(),
      getSession: async () => ({
        user: { name: "Test Pilot", email: "pilot@example.invalid", id: "internal-user" },
        session: { id: "internal-session", token: "internal-token" },
      }),
      redirectUnauthenticated: () => { throw new Error("unexpected redirect"); },
    });
    process.stdout.write(JSON.stringify(user));
  `)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    name: "Test Pilot",
    email: "pilot@example.invalid",
  })
})

test("Next server adapter supplies Better Auth and awaited request headers", async () => {
  const adapter = await source("lib/auth-session.js")

  assert.match(adapter, /from ["']next\/headers["']/)
  assert.match(adapter, /from ["']next\/navigation["']/)
  assert.match(adapter, /getSession: auth\.api\.getSession/)
  assert.match(adapter, /getRequestHeaders: headers/)
  assert.match(adapter, /redirectUnauthenticated: redirect/)
  assert.doesNotMatch(adapter, /cookie|token|console\./)
})

test("registration form has required labels, limits, and autocomplete semantics", async () => {
  const form = await source("app/register/register-form.js")

  for (const label of ["Name", "Email", "Password", "Confirm password"]) {
    assert.match(form, new RegExp(`>${label}<`))
  }
  assert.match(form, /autoComplete="name"/)
  assert.match(form, /autoComplete="email"/)
  assert.equal((form.match(/autoComplete="new-password"/g) ?? []).length, 2)
  assert.match(form, /MINIMUM_PASSWORD_LENGTH = 8/)
  assert.match(form, /MAXIMUM_PASSWORD_LENGTH = 128/)
  assert.match(form, /password !== passwordConfirmation/)
  assert.match(form, /aria-live="polite"/)
  assert.doesNotMatch(form, /console\./)
})

test("login and logout controls use safe semantics without logging auth values", async () => {
  const login = await source("app/login/login-form.js")
  const logout = await source("app/account/logout-button.js")

  assert.match(login, />Email</)
  assert.match(login, />Password</)
  assert.match(login, /autoComplete="email"/)
  assert.match(login, /autoComplete="current-password"/)
  assert.match(login, /Email or password is incorrect\./)
  assert.match(login, /aria-live="polite"/)
  assert.match(logout, /authClient\.signOut\(\)/)
  assert.match(logout, /router\.replace\("\/login"\)/)
  assert.match(logout, /router\.refresh\(\)/)
  assert.doesNotMatch(`${login}\n${logout}`, /console\./)
})
