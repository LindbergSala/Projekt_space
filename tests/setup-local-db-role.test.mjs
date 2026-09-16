import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  SetupError,
  appendDatabaseUrl,
  appendMigrationDatabaseUrl,
  appendShadowDatabaseUrl,
  assertExpectedMigrationDefaultPrivileges,
  assertRestrictedLoginRole,
  createMigrationDatabaseUrl,
  createMigrationRoleWithNativeClient,
  createRoleWithNativeClient,
  createDatabaseUrl,
  createShadowDatabaseUrl,
  createTemporaryCredentialPath,
  parseCompatibleDatabaseUrl,
  parseCompatibleMigrationDatabaseUrl,
  parseCompatibleShadowDatabaseUrl,
  parseUniqueEnvValue,
  persistCredentialFile,
  reconcileRoleSetup,
  reconcileMigrationRoleSetup,
  reconcileShadowCredential,
  reconcileShadowDatabase,
} from "../scripts/setup-local-db-role.mjs"

const TEST_PASSWORD = "synthetic-test-password"
const TEST_MIGRATION_PASSWORD = "independent-synthetic-migration-password"
const VALID_URL = createDatabaseUrl(TEST_PASSWORD)
const VALID_MIGRATION_URL = createMigrationDatabaseUrl(TEST_MIGRATION_PASSWORD)
const VALID_SHADOW_URL = createShadowDatabaseUrl(TEST_PASSWORD)
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(
  TEST_DIRECTORY,
  "../scripts/setup-local-db-role.mjs",
)
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, "..")

function temporaryFileOptions(overrides = {}) {
  return {
    verifyTemporaryPathIgnored() {},
    ...overrides,
  }
}

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

test("encoded CR, LF, and NUL passwords fail before mutations", async () => {
  for (const password of ["unsafe\rpassword", "unsafe\npassword", "unsafe\0password"]) {
    const calls = []

    await assert.rejects(
      reconcileRoleSetup({
        appSource: `DATABASE_URL=${createDatabaseUrl(password)}\n`,
        existingRole: null,
        ...callbacks({
          persistCredentials: async () => calls.push("persist"),
          createNewRole: async () => calls.push("create"),
        }),
      }),
      /unsupported control characters/,
    )

    assert.deepEqual(calls, [])
  }
})

test("ordinary URL-encoded password characters remain supported", () => {
  const password = "spaces /:@?%#[] remain encoded"

  assert.equal(
    parseCompatibleDatabaseUrl(createDatabaseUrl(password)),
    password,
  )
})

test("shadow URL requires the dedicated database and reuses the password", () => {
  assert.equal(
    parseCompatibleShadowDatabaseUrl(VALID_SHADOW_URL),
    TEST_PASSWORD,
  )
  assert.throws(
    () => parseCompatibleShadowDatabaseUrl(VALID_URL),
    /SHADOW_DATABASE_URL targets unexpected local database settings/,
  )
})

test("missing shadow credentials are appended without changing other values", async () => {
  const appSource = `UNRELATED_SETTING=preserved\nDATABASE_URL=${VALID_URL}\n`
  let persisted

  const result = await reconcileShadowCredential({
    appSource,
    password: TEST_PASSWORD,
    persistCredentials: async (value) => {
      persisted = value
    },
  })

  assert.equal(result.credentialsWritten, true)
  assert.equal(persisted.expectedSource, appSource)
  assert.equal(
    persisted.nextSource,
    appendShadowDatabaseUrl(appSource, VALID_SHADOW_URL),
  )
  assert.match(persisted.nextSource, /^UNRELATED_SETTING=preserved$/m)
})

test("compatible shadow credentials are reused without a write", async () => {
  const appSource =
    `DATABASE_URL=${VALID_URL}\nSHADOW_DATABASE_URL=${VALID_SHADOW_URL}\n`
  let persistCount = 0

  const result = await reconcileShadowCredential({
    appSource,
    password: TEST_PASSWORD,
    persistCredentials: async () => {
      persistCount += 1
    },
  })

  assert.equal(result.credentialsWritten, false)
  assert.equal(persistCount, 0)
})

test("shadow credentials with another password are rejected before writing", async () => {
  const appSource =
    `DATABASE_URL=${VALID_URL}\n` +
    `SHADOW_DATABASE_URL=${createShadowDatabaseUrl("different-password")}\n`
  let persistCount = 0

  await assert.rejects(
    reconcileShadowCredential({
      appSource,
      password: TEST_PASSWORD,
      persistCredentials: async () => {
        persistCount += 1
      },
    }),
    /use different credentials/,
  )

  assert.equal(persistCount, 0)
})

test("shadow database reconciliation is idempotent and rejects another owner", async () => {
  let createCount = 0
  let verifyCount = 0
  const callbacks = {
    createDatabase: async () => {
      createCount += 1
    },
    verifyCreatedDatabase: async () => {
      verifyCount += 1
    },
  }

  const existing = await reconcileShadowDatabase({
    existingOwner: "projekt_space_app",
    ...callbacks,
  })
  assert.equal(existing.created, false)
  assert.equal(createCount, 0)
  assert.equal(verifyCount, 0)

  await assert.rejects(
    reconcileShadowDatabase({
      existingOwner: "unexpected_owner",
      ...callbacks,
    }),
    /unexpected owner/,
  )
  assert.equal(createCount, 0)

  const created = await reconcileShadowDatabase({
    existingOwner: null,
    ...callbacks,
  })
  assert.equal(created.created, true)
  assert.equal(createCount, 1)
  assert.equal(verifyCount, 1)
})

test("migration URL requires the migration role on the development database", () => {
  assert.equal(
    parseCompatibleMigrationDatabaseUrl(VALID_MIGRATION_URL),
    TEST_MIGRATION_PASSWORD,
  )

  for (const invalidUrl of [
    VALID_URL,
    createMigrationDatabaseUrl(TEST_MIGRATION_PASSWORD).replace(
      "projekt_space_dev",
      "projekt_space_shadow",
    ),
  ]) {
    assert.throws(
      () => parseCompatibleMigrationDatabaseUrl(invalidUrl),
      /MIGRATION_DATABASE_URL targets unexpected local database settings/,
    )
  }
})

test("first migration-role setup creates an independent persisted credential", async () => {
  const appSource = `DATABASE_URL=${VALID_URL}\n`
  let persisted
  let createdPassword
  let verifiedPassword

  const result = await reconcileMigrationRoleSetup({
    appSource,
    applicationPassword: TEST_PASSWORD,
    existingRole: null,
    ...callbacks({
      generatePassword: () => TEST_MIGRATION_PASSWORD,
      persistCredentials: async (value) => {
        persisted = value
      },
      createNewRole: async (password) => {
        createdPassword = password
      },
      verifyNewRole: async (password) => {
        verifiedPassword = password
      },
    }),
  })

  assert.deepEqual(result, { created: true, credentialsWritten: true })
  assert.equal(persisted.expectedSource, appSource)
  assert.equal(
    persisted.nextSource,
    appendMigrationDatabaseUrl(appSource, VALID_MIGRATION_URL),
  )
  assert.equal(createdPassword, TEST_MIGRATION_PASSWORD)
  assert.equal(verifiedPassword, TEST_MIGRATION_PASSWORD)
  assert.notEqual(createdPassword, TEST_PASSWORD)
})

test("existing migration-role setup reuses credentials without mutation", async () => {
  const appSource =
    `DATABASE_URL=${VALID_URL}\n` +
    `MIGRATION_DATABASE_URL=${VALID_MIGRATION_URL}\n`
  const calls = []

  const result = await reconcileMigrationRoleSetup({
    appSource,
    applicationPassword: TEST_PASSWORD,
    existingRole: { oid: 2 },
    ...callbacks({
      authenticateExistingRole: async (password) => {
        assert.equal(password, TEST_MIGRATION_PASSWORD)
        calls.push("authenticate")
      },
      verifyExistingRole: async () => calls.push("verify"),
      persistCredentials: async () => calls.push("persist"),
      createNewRole: async () => calls.push("create"),
    }),
  })

  assert.deepEqual(result, { created: false, credentialsWritten: false })
  assert.deepEqual(calls, ["authenticate", "verify"])
})

test("conflicting migration credentials fail before writes or role creation", async () => {
  const calls = []

  await assert.rejects(
    reconcileMigrationRoleSetup({
      appSource:
        `DATABASE_URL=${VALID_URL}\n` +
        `MIGRATION_DATABASE_URL=${createMigrationDatabaseUrl(TEST_PASSWORD)}\n`,
      applicationPassword: TEST_PASSWORD,
      existingRole: null,
      ...callbacks({
        persistCredentials: async () => calls.push("persist"),
        createNewRole: async () => calls.push("create"),
      }),
    }),
    /must use different credentials/,
  )

  await assert.rejects(
    reconcileMigrationRoleSetup({
      appSource: `DATABASE_URL=${VALID_URL}\n`,
      applicationPassword: TEST_PASSWORD,
      existingRole: { oid: 2 },
      ...callbacks({
        authenticateExistingRole: async () => calls.push("authenticate"),
      }),
    }),
    /exists without compatible local credentials/,
  )

  assert.deepEqual(calls, [])
})

test("runtime and migration roles retain restricted login attributes", () => {
  const restrictedRole = {
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  }

  assert.doesNotThrow(() =>
    assertRestrictedLoginRole(restrictedRole, "synthetic"),
  )

  for (const attribute of [
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolreplication",
    "rolbypassrls",
  ]) {
    assert.throws(
      () => assertRestrictedLoginRole(
        { ...restrictedRole, [attribute]: true },
        "synthetic",
      ),
      /unexpected attributes/,
    )
  }
})

test("migration default privileges are exact and grant no grant option", () => {
  const rows = [
    ...["SELECT", "INSERT", "UPDATE", "DELETE"].map((privilegeType) => ({
      schema_name: "public",
      object_type: "r",
      grantee_role: "projekt_space_app",
      privilege_type: privilegeType,
      is_grantable: false,
    })),
    ...["USAGE", "SELECT"].map((privilegeType) => ({
      schema_name: "public",
      object_type: "S",
      grantee_role: "projekt_space_app",
      privilege_type: privilegeType,
      is_grantable: false,
    })),
  ]

  assert.doesNotThrow(() => assertExpectedMigrationDefaultPrivileges(rows))
  assert.throws(
    () => assertExpectedMigrationDefaultPrivileges([
      ...rows,
      {
        schema_name: "public",
        object_type: "r",
        grantee_role: "projekt_space_app",
        privilege_type: "TRUNCATE",
        is_grantable: false,
      },
    ]),
    /incomplete or unexpected/,
  )
  assert.throws(
    () => assertExpectedMigrationDefaultPrivileges(
      rows.map((row, index) => index === 0
        ? { ...row, is_grantable: true }
        : row),
    ),
    /unexpected default-privilege recipients/,
  )
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
  }, temporaryFileOptions())

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
    }, temporaryFileOptions()),
    /changed before it could be updated/,
  )

  assert.equal(await readFile(filePath, "utf8"), current)
})

test("the generated temporary credential filename is ignored", () => {
  const temporaryPath = createTemporaryCredentialPath(
    path.join(REPOSITORY_ROOT, ".env.local"),
    "synthetic-ignore-check",
  )
  const relativePath = path.relative(REPOSITORY_ROOT, temporaryPath)
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", "--", relativePath],
    {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
      windowsHide: true,
    },
  )

  assert.equal(path.basename(temporaryPath), ".env.local.synthetic-ignore-check.tmp")
  assert.equal(result.status, 0)
})

test("partial credential writes remove the owned temporary file", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projekt-space-role-test-"))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const filePath = path.join(directory, ".env.local")
  const uniqueId = "partial-write"
  const temporaryPath = createTemporaryCredentialPath(filePath, uniqueId)
  const original = "UNRELATED_SETTING=preserved\n"
  const calls = []
  await writeFile(filePath, original, "utf8")

  await assert.rejects(
    reconcileRoleSetup({
      appSource: original,
      existingRole: null,
      ...callbacks({
        persistCredentials: async ({ expectedSource, nextSource }) => {
          calls.push("persist")
          await persistCredentialFile({
            filePath,
            expectedSource,
            nextSource,
          }, temporaryFileOptions({
            uniqueId,
            async openFile(...args) {
              const handle = await open(...args)
              return {
                close: () => handle.close(),
                async writeFile(value, encoding) {
                  await handle.writeFile(value.slice(0, 12), encoding)
                  throw new Error("Synthetic partial write failure.")
                },
              }
            },
          }))
        },
        createNewRole: async () => calls.push("create"),
      }),
    }),
    /could not be persisted safely/,
  )

  assert.deepEqual(calls, ["persist"])
  assert.equal(await readFile(filePath, "utf8"), original)
  await assert.rejects(readFile(temporaryPath, "utf8"), { code: "ENOENT" })
})

test("exclusive-create failure never removes another temporary file", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projekt-space-role-test-"))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const filePath = path.join(directory, ".env.local")
  const uniqueId = "already-owned"
  const temporaryPath = createTemporaryCredentialPath(filePath, uniqueId)
  const original = "UNRELATED_SETTING=preserved\n"
  const sentinel = "PREEXISTING_SYNTHETIC_CONTENT\n"
  await writeFile(filePath, original, "utf8")
  await writeFile(temporaryPath, sentinel, "utf8")

  await assert.rejects(
    persistCredentialFile({
      filePath,
      expectedSource: original,
      nextSource: appendDatabaseUrl(original, VALID_URL),
    }, temporaryFileOptions({ uniqueId })),
    /could not be persisted safely/,
  )

  assert.equal(await readFile(filePath, "utf8"), original)
  assert.equal(await readFile(temporaryPath, "utf8"), sentinel)
})

test("temporary credential cleanup failures are reported", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projekt-space-role-test-"))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const filePath = path.join(directory, ".env.local")
  const original = "UNRELATED_SETTING=preserved\n"
  await writeFile(filePath, original, "utf8")

  await assert.rejects(
    persistCredentialFile({
      filePath,
      expectedSource: original,
      nextSource: appendDatabaseUrl(original, VALID_URL),
    }, temporaryFileOptions({
      async openFile(...args) {
        const handle = await open(...args)
        return {
          close: () => handle.close(),
          async writeFile() {
            throw new Error("Synthetic write failure.")
          },
        }
      },
      async removeFile() {
        throw new Error("Synthetic cleanup failure.")
      },
    })),
    /could not be removed safely/,
  )

  assert.equal(await readFile(filePath, "utf8"), original)
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

test("native migration-role setup grants only the reviewed privileges", () => {
  let inspected = false

  createMigrationRoleWithNativeClient(TEST_MIGRATION_PASSWORD, {
    repositoryRoot: os.tmpdir(),
    spawn(command, args, options) {
      inspected = true
      assert.equal(command, "docker")
      assert.doesNotMatch(JSON.stringify(args), new RegExp(TEST_MIGRATION_PASSWORD))
      assert.match(options.input, /CREATE ROLE projekt_space_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/)
      assert.match(options.input, /GRANT CONNECT ON DATABASE projekt_space_dev TO projekt_space_migrator/)
      assert.match(options.input, /GRANT USAGE, CREATE ON SCHEMA public TO projekt_space_migrator/)
      assert.match(options.input, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO projekt_space_app/)
      assert.match(options.input, /GRANT USAGE, SELECT ON SEQUENCES TO projekt_space_app/)

      const passwordLines = options.input
        .split("\n")
        .filter((line) => line === TEST_MIGRATION_PASSWORD)
      const sqlLines = options.input
        .split("\n")
        .filter((line) => line.trimEnd().endsWith(";"))

      assert.equal(passwordLines.length, 2)
      assert.equal(
        sqlLines.some((line) => line.includes(TEST_MIGRATION_PASSWORD)),
        false,
      )
      return { status: 0, stdout: "", stderr: "" }
    },
  })

  assert.equal(inspected, true)
})

test("unsafe native-client passwords never spawn a process", () => {
  for (const password of ["unsafe\rpassword", "unsafe\npassword", "unsafe\0password"]) {
    let spawnCount = 0

    assert.throws(
      () => createRoleWithNativeClient(password, {
        spawn() {
          spawnCount += 1
          return { status: 0, stdout: "", stderr: "" }
        },
      }),
      /unsupported control characters/,
    )

    assert.equal(spawnCount, 0)
  }
})
