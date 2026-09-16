import assert from "node:assert/strict"
import test from "node:test"

import {
  MetadataHardeningError,
  hardenPrismaMigrationMetadata,
  sanitizedHardeningFailure,
} from "../scripts/harden-prisma-migration-metadata.mjs"
import {
  runMigrationWorkflow,
  validateMigrateDevArguments,
} from "../scripts/prisma-migrate-dev.mjs"
import {
  buildComposeArguments,
  loadToolingEnvironment,
  runContainerMigration,
} from "../scripts/prisma-migrate-dev-docker.mjs"

const SYNTHETIC_MIGRATION_URL =
  "postgresql://projekt_space_migrator:synthetic-password@127.0.0.1:55432/projekt_space_dev"
const SYNTHETIC_ENVIRONMENT_SOURCE = [
  "DATABASE_URL=postgresql://projekt_space_app:synthetic-app-password@127.0.0.1:55432/projekt_space_dev",
  "MIGRATION_DATABASE_URL=postgresql://projekt_space_migrator:synthetic-migration-password@127.0.0.1:55432/projekt_space_dev",
  "SHADOW_DATABASE_URL=postgresql://projekt_space_app:synthetic-app-password@127.0.0.1:55432/projekt_space_shadow",
].join("\n")

function createMetadataState(overrides = {}) {
  return {
    userName: "projekt_space_migrator",
    databaseName: "projekt_space_dev",
    tableExists: true,
    owner: "projekt_space_migrator",
    objectType: "r",
    directPrivilegeCount: 4,
    effectivePrivileges: {
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
      can_truncate: false,
      can_reference: false,
      can_trigger: false,
      can_maintain: false,
    },
    revokeCount: 0,
    rollbackCount: 0,
    ...overrides,
  }
}

function createFakeClient(state) {
  return {
    async connect() {},
    async end() {},
    async query(sql) {
      if (sql === "ROLLBACK") {
        state.rollbackCount += 1
        return { rowCount: 0, rows: [] }
      }

      if (sql.includes("current_user AS user_name")) {
        return {
          rowCount: 1,
          rows: [{
            user_name: state.userName,
            database_name: state.databaseName,
          }],
        }
      }

      if (sql.includes("owner_role.rolname AS owner_name")) {
        return state.tableExists
          ? {
              rowCount: 1,
              rows: [{
                owner_name: state.owner,
                object_type: state.objectType,
              }],
            }
          : { rowCount: 0, rows: [] }
      }

      if (sql.includes("REVOKE ALL PRIVILEGES")) {
        state.revokeCount += 1
        state.directPrivilegeCount = 0
        for (const name of Object.keys(state.effectivePrivileges)) {
          state.effectivePrivileges[name] = false
        }
        return { rowCount: 0, rows: [] }
      }

      if (sql.includes("direct_privilege_count")) {
        return {
          rowCount: 1,
          rows: [{
            direct_privilege_count: state.directPrivilegeCount,
            ...state.effectivePrivileges,
          }],
        }
      }

      return { rowCount: 0, rows: [] }
    },
  }
}

async function runHardener(state) {
  return hardenPrismaMigrationMetadata({
    migrationDatabaseUrl: SYNTHETIC_MIGRATION_URL,
    createClient: () => createFakeClient(state),
  })
}

test("metadata hardening succeeds as a no-op when the table is absent", async () => {
  const state = createMetadataState({ tableExists: false })

  assert.deepEqual(await runHardener(state), {
    tableExists: false,
    revoked: false,
  })
  assert.equal(state.revokeCount, 0)
  assert.equal(state.rollbackCount, 0)
})

test("metadata hardening revokes and verifies every runtime privilege", async () => {
  const state = createMetadataState()

  assert.deepEqual(await runHardener(state), {
    tableExists: true,
    revoked: true,
  })
  assert.equal(state.revokeCount, 1)
  assert.equal(state.directPrivilegeCount, 0)
  assert.equal(
    Object.values(state.effectivePrivileges).some(Boolean),
    false,
  )
})

test("metadata hardening rejects an unexpected owner before revoking", async () => {
  const state = createMetadataState({ owner: "unexpected_owner" })

  await assert.rejects(
    runHardener(state),
    /unexpected owner or object type/,
  )
  assert.equal(state.revokeCount, 0)
  assert.equal(state.rollbackCount, 1)
})

test("metadata hardening rejects an unexpected database identity", async () => {
  const state = createMetadataState({ databaseName: "unexpected_database" })

  await assert.rejects(
    runHardener(state),
    /unexpected database identity/,
  )
  assert.equal(state.revokeCount, 0)
  assert.equal(state.rollbackCount, 1)
})

test("metadata hardening is idempotent", async () => {
  const state = createMetadataState()

  await runHardener(state)
  await runHardener(state)

  assert.equal(state.revokeCount, 2)
  assert.equal(state.directPrivilegeCount, 0)
  assert.equal(
    Object.values(state.effectivePrivileges).some(Boolean),
    false,
  )
})

test("metadata hardening failures do not expose credentials", async () => {
  const secret = "never-print-this-secret"

  await assert.rejects(
    hardenPrismaMigrationMetadata({
      migrationDatabaseUrl:
        `postgresql://wrong-role:${secret}@127.0.0.1:55432/projekt_space_dev`,
      createClient: () => assert.fail("Invalid URLs must not create a client."),
    }),
    (error) => {
      const message = sanitizedHardeningFailure(error)
      assert.doesNotMatch(message, new RegExp(secret))
      assert.match(message, /MIGRATION_DATABASE_URL/)
      return true
    },
  )

  assert.doesNotMatch(
    sanitizedHardeningFailure(
      Object.assign(new Error(secret), { code: "SYNTHETIC" }),
    ),
    new RegExp(secret),
  )
})

test("migration wrapper hardens after successful Prisma execution", async () => {
  let hardenCount = 0
  const exitCode = await runMigrationWorkflow(
    ["--create-only", "--name", "synthetic_migration"],
    {
      spawnPrisma: () => ({ status: 0 }),
      hardenMetadata: async () => {
        hardenCount += 1
      },
    },
  )

  assert.equal(exitCode, 0)
  assert.equal(hardenCount, 1)
})

test("migration wrapper hardens after failed Prisma execution", async () => {
  let hardenCount = 0
  const exitCode = await runMigrationWorkflow([], {
    spawnPrisma: () => ({ status: 7 }),
    hardenMetadata: async () => {
      hardenCount += 1
    },
  })

  assert.equal(exitCode, 7)
  assert.equal(hardenCount, 1)
})

test("migration wrapper hardens when Prisma fails to start", async () => {
  let hardenCount = 0
  const messages = []
  const exitCode = await runMigrationWorkflow([], {
    spawnPrisma: () => {
      throw new Error("synthetic spawn failure with sensitive detail")
    },
    hardenMetadata: async () => {
      hardenCount += 1
    },
    reportError: (message) => messages.push(message),
  })

  assert.equal(exitCode, 1)
  assert.equal(hardenCount, 1)
  assert.deepEqual(messages, ["Prisma migrate dev failed to start."])
})

test("migration wrapper reports hardening failure through its exit status", async () => {
  const messages = []
  const exitCode = await runMigrationWorkflow([], {
    spawnPrisma: () => ({ status: 0 }),
    hardenMetadata: async () => {
      throw new MetadataHardeningError("Synthetic hardening failure.")
    },
    reportError: (message) => messages.push(message),
  })

  assert.equal(exitCode, 1)
  assert.deepEqual(messages, ["Hardening failed: Synthetic hardening failure."])
})

test("migration wrapper rejects unsupported or destructive arguments", async () => {
  const rejectedArguments = [
    ["reset"],
    ["deploy"],
    ["db", "push"],
    ["--schema", "other.prisma"],
    ["--config", "other.config.mjs"],
    ["--url", "synthetic-value"],
    ["--create-only", "--create-only"],
    ["--name", "invalid name"],
  ]

  for (const args of rejectedArguments) {
    let spawnCount = 0
    let hardenCount = 0
    const messages = []
    const exitCode = await runMigrationWorkflow(args, {
      spawnPrisma: () => {
        spawnCount += 1
        return { status: 0 }
      },
      hardenMetadata: async () => {
        hardenCount += 1
      },
      reportError: (message) => messages.push(message),
    })

    assert.equal(exitCode, 1)
    assert.equal(spawnCount, 0)
    assert.equal(hardenCount, 0)
    assert.equal(messages.length, 1)
    assert.match(messages[0], /rejected/)
  }
})

test("migration wrapper accepts only the documented option forms", () => {
  assert.deepEqual(validateMigrateDevArguments([]), [])
  assert.deepEqual(
    validateMigrateDevArguments([
      "--create-only",
      "--name",
      "add_better_auth_schema",
    ]),
    ["--create-only", "--name", "add_better_auth_schema"],
  )
  assert.deepEqual(
    validateMigrateDevArguments(["--name=next_migration"]),
    ["--name=next_migration"],
  )
})

test("host launcher translates only the documented local database endpoints", async () => {
  const environment = await loadToolingEnvironment({
    readEnvironmentFile: async () => SYNTHETIC_ENVIRONMENT_SOURCE,
  })

  assert.deepEqual(Object.keys(environment).sort(), [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "SHADOW_DATABASE_URL",
  ])

  for (const value of Object.values(environment)) {
    const url = new URL(value)
    assert.equal(url.hostname, "postgres")
    assert.equal(url.port, "5432")
    assert.doesNotMatch(value, /127\.0\.0\.1|55432/u)
  }
})

test("host launcher rejects unexpected endpoints without exposing credentials", async () => {
  const secret = "never-print-this-launcher-secret"
  const messages = []
  const source = SYNTHETIC_ENVIRONMENT_SOURCE.replace(
    "127.0.0.1:55432/projekt_space_dev",
    `unexpected.example:5432/projekt_space_dev?secret=${secret}`,
  )
  let spawnCount = 0

  const exitCode = await runContainerMigration([], {
    loadEnvironment: () => loadToolingEnvironment({
      readEnvironmentFile: async () => source,
    }),
    spawnCompose: () => {
      spawnCount += 1
      return { status: 0 }
    },
    reportError: (message) => messages.push(message),
  })

  assert.equal(exitCode, 1)
  assert.equal(spawnCount, 0)
  assert.equal(messages.length, 1)
  assert.doesNotMatch(messages[0], new RegExp(secret))
  assert.match(messages[0], /DATABASE_URL/)
})

test("host launcher rejects unsupported arguments before reading credentials", async () => {
  let loadCount = 0
  let spawnCount = 0
  const messages = []

  const exitCode = await runContainerMigration(["--schema", "other.prisma"], {
    loadEnvironment: async () => {
      loadCount += 1
      return {}
    },
    spawnCompose: () => {
      spawnCount += 1
      return { status: 0 }
    },
    reportError: (message) => messages.push(message),
  })

  assert.equal(exitCode, 1)
  assert.equal(loadCount, 0)
  assert.equal(spawnCount, 0)
  assert.deepEqual(messages, [
    "Migration workflow rejected: Unsupported Prisma migrate dev option.",
  ])
})

test("host launcher invokes only the fixed Compose service and propagates exit status", async () => {
  const environment = {
    DATABASE_URL: "synthetic-main",
    MIGRATION_DATABASE_URL: "synthetic-migration",
    SHADOW_DATABASE_URL: "synthetic-shadow",
  }
  let invocation

  const exitCode = await runContainerMigration(
    ["--create-only", "--name", "next_migration"],
    {
      loadEnvironment: async () => environment,
      spawnCompose: (args, receivedEnvironment) => {
        invocation = { args, environment: receivedEnvironment }
        return { status: 23 }
      },
    },
  )

  assert.equal(exitCode, 23)
  assert.deepEqual(invocation, {
    args: [
      "compose",
      "--file",
      "compose.prisma.yaml",
      "--project-name",
      "projekt-space-prisma-tooling",
      "run",
      "--rm",
      "--no-deps",
      "prisma-tooling",
      "--create-only",
      "--name",
      "next_migration",
    ],
    environment,
  })
})

test("host launcher command cannot select a Windows or host Prisma engine", () => {
  const args = buildComposeArguments(["--create-only"])
  const serialized = args.join(" ")

  assert.equal(args[0], "compose")
  assert.match(serialized, /prisma-tooling/u)
  assert.doesNotMatch(serialized, /schema-engine|node_modules|prisma\.cmd/u)
})

test("inner wrapper refuses its default Prisma process outside the tooling container", async () => {
  const previousMarker = process.env.PRISMA_TOOLING_CONTAINER
  const messages = []
  let hardenCount = 0

  delete process.env.PRISMA_TOOLING_CONTAINER
  try {
    const exitCode = await runMigrationWorkflow(["--create-only"], {
      hardenMetadata: async () => {
        hardenCount += 1
      },
      reportError: (message) => messages.push(message),
    })

    assert.equal(exitCode, 1)
    assert.equal(hardenCount, 1)
    assert.deepEqual(messages, ["Prisma migrate dev failed to start."])
  } finally {
    if (previousMarker === undefined) {
      delete process.env.PRISMA_TOOLING_CONTAINER
    } else {
      process.env.PRISMA_TOOLING_CONTAINER = previousMarker
    }
  }
})
