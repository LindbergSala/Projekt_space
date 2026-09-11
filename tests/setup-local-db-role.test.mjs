import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  SetupError,
  appendDatabaseUrl,
  createRoleWithNativeClient,
  createDatabaseUrl,
  parseCompatibleDatabaseUrl,
  parseUniqueEnvValue,
  persistCredentialFile,
  reconcileRoleSetup,
} from "../scripts/setup-local-db-role.mjs"

const TEST_PASSWORD = "synthetic-test-password"
const VALID_URL = createDatabaseUrl(TEST_PASSWORD)
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(
  TEST_DIRECTORY,
  "../scripts/setup-local-db-role.mjs",
)

function callbacks(overrides = {}) {
  return {
    authenticateExistingRole: async () => {},
    verifyExistingRole: async () => {},
    persistCredentials: async () => {},
    createNewRole: async () => {},
    verifyNewRole: async () => {},
    generatePassword: () => TEST_PASSWORD,
    ...overrides,
  }
}

test("importing the module does not execute setup", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(SCRIPT_PATH).href)})`,
    ],
    {
      cwd: os.tmpdir(),
      encoding: "utf8",
      windowsHide: true,
    },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
})

test("dotenv parsing accepts indented and exported assignments", () => {
  assert.equal(
    parseUniqueEnvValue(`  export DATABASE_URL = "${VALID_URL}"\n`, "DATABASE_URL"),
    VALID_URL,
  )
})

test("mixed-indentation duplicate assignments are rejected", () => {
  const source = `  DATABASE_URL=${VALID_URL}\n\texport DATABASE_URL=${VALID_URL}\n`

  assert.throws(
    () => parseUniqueEnvValue(source, "DATABASE_URL"),
    /Multiple DATABASE_URL assignments/,
  )
})

test("ambiguous DATABASE_URL syntax is rejected", () => {
  assert.throws(
    () => parseUniqueEnvValue(" export DATABASE_URL\n", "DATABASE_URL"),
    /Unsupported DATABASE_URL assignment syntax/,
  )
})

test("placeholder password, query parameters, and fragments are rejected", () => {
  assert.throws(
    () => parseCompatibleDatabaseUrl(createDatabaseUrl("replace-with-generated-password")),
    /example password/,
  )
  assert.throws(
    () => parseCompatibleDatabaseUrl(`${VALID_URL}?schema=public`),
    /query parameters and fragments/,
  )
  assert.throws(
    () => parseCompatibleDatabaseUrl(`${VALID_URL}#fragment`),
    /query parameters and fragments/,
  )
})

test("incorrect connection targets are rejected", () => {
  const invalidUrls = [
    VALID_URL.replace("postgresql:", "postgres:"),
    VALID_URL.replace("127.0.0.1", "localhost"),
    VALID_URL.replace("55432", "5432"),
    VALID_URL.replace("projekt_space_dev", "other_database"),
    VALID_URL.replace("projekt_space_app", "other_role"),
    createDatabaseUrl(""),
  ]

  for (const value of invalidUrls) {
    assert.throws(
      () => parseCompatibleDatabaseUrl(value),
      SetupError,
    )
  }
})

test("invalid input causes no persistent or database writes", async () => {
  const calls = []

  await assert.rejects(
    reconcileRoleSetup({
      appSource: `DATABASE_URL=${VALID_URL}?unsupported=true\n`,
      existingRole: null,
      ...callbacks({
        persistCredentials: async () => calls.push("persist"),
        createNewRole: async () => calls.push("create"),
      }),
    }),
    SetupError,
  )

  assert.deepEqual(calls, [])
})

test("failed existing-role authentication causes no persistent writes", async () => {
  const calls = []

  await assert.rejects(
    reconcileRoleSetup({
      appSource: `DATABASE_URL=${VALID_URL}\n`,
      existingRole: { oid: 1 },
      ...callbacks({
        authenticateExistingRole: async () => {
          calls.push("authenticate")
          throw new SetupError("Synthetic authentication failure.")
        },
        verifyExistingRole: async () => calls.push("verify"),
        persistCredentials: async () => calls.push("persist"),
        createNewRole: async () => calls.push("create"),
      }),
    }),
    /Synthetic authentication failure/,
  )

  assert.deepEqual(calls, ["authenticate"])
})

test("credential persistence failure prevents new-role creation", async () => {
  const calls = []

  await assert.rejects(
    reconcileRoleSetup({
      appSource: null,
      existingRole: null,
      ...callbacks({
        persistCredentials: async () => {
          calls.push("persist")
          throw new SetupError("Synthetic write failure.")
        },
        createNewRole: async () => calls.push("create"),
      }),
    }),
    /Synthetic write failure/,
  )

  assert.deepEqual(calls, ["persist"])
})

test("saved credentials remain reusable after database failure", async () => {
  let savedSource = null
  let firstPassword
  let secondPassword

  await assert.rejects(
    reconcileRoleSetup({
      appSource: savedSource,
      existingRole: null,
      ...callbacks({
        persistCredentials: async ({ nextSource }) => {
          savedSource = nextSource
        },
        createNewRole: async (password) => {
          firstPassword = password
          throw new SetupError("Synthetic database failure.")
        },
      }),
    }),
    /Synthetic database failure/,
  )

  await reconcileRoleSetup({
    appSource: savedSource,
    existingRole: null,
    ...callbacks({
      persistCredentials: async () => {
        assert.fail("Persist must not run when saved credentials are reusable.")
      },
      createNewRole: async (password) => {
        secondPassword = password
      },
    }),
  })

  assert.equal(secondPassword, firstPassword)
})

test("credential persistence preserves unrelated environment entries", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projekt-space-role-test-"))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const filePath = path.join(directory, ".env.local")
  const original = "UNRELATED_SETTING=keep-this-value\n"
  const nextSource = appendDatabaseUrl(original, VALID_URL)
  await writeFile(filePath, original, "utf8")

  await persistCredentialFile({
    filePath,
    expectedSource: original,
    nextSource,
  })

  const persisted = await readFile(filePath, "utf8")
  assert.equal(persisted, nextSource)
  assert.match(persisted, /^UNRELATED_SETTING=keep-this-value$/m)
  assert.equal(parseUniqueEnvValue(persisted, "DATABASE_URL"), VALID_URL)
})

test("credential persistence refuses to overwrite a changed file", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projekt-space-role-test-"))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const filePath = path.join(directory, ".env.local")
  const current = "CURRENT_SETTING=preserve-this\n"
  await writeFile(filePath, current, "utf8")

  await assert.rejects(
    persistCredentialFile({
      filePath,
      expectedSource: "STALE_SETTING=old-value\n",
      nextSource: appendDatabaseUrl(current, VALID_URL),
    }),
    /changed before it could be updated/,
  )

  assert.equal(await readFile(filePath, "utf8"), current)
})

test("native password setup keeps credentials out of arguments and SQL", () => {
  let inspected = false

  createRoleWithNativeClient(TEST_PASSWORD, {
    repositoryRoot: os.tmpdir(),
    spawn(command, args, options) {
      inspected = true
      assert.equal(command, "docker")
      assert.doesNotMatch(JSON.stringify(args), new RegExp(TEST_PASSWORD))
      assert.match(options.input, /\\password projekt_space_app/)

      const passwordLines = options.input
        .split("\n")
        .filter((line) => line === TEST_PASSWORD)
      const sqlLines = options.input
        .split("\n")
        .filter((line) => line.trimEnd().endsWith(";"))

      assert.equal(passwordLines.length, 2)
      assert.equal(sqlLines.some((line) => line.includes(TEST_PASSWORD)), false)
      return { status: 0, stdout: "", stderr: "" }
    },
  })

  assert.equal(inspected, true)
})
