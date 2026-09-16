import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_URL = pathToFileURL(
  path.resolve(TEST_DIRECTORY, "../prisma.config.mjs"),
).href
const MAIN_URL =
  "postgresql://app:synthetic-password@127.0.0.1:55432/projekt_space_dev"
const MIGRATION_URL =
  "postgresql://migrator:independent-synthetic-password@127.0.0.1:55432/projekt_space_dev"
const SHADOW_URL =
  "postgresql://app:synthetic-password@127.0.0.1:55432/projekt_space_shadow"

function runConfigCheck({
  databaseUrl = MAIN_URL,
  migrationDatabaseUrl = "",
  shadowDatabaseUrl = "",
} = {}, expression = "") {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { default: config } = await import(${JSON.stringify(CONFIG_URL)}); ${expression}`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: migrationDatabaseUrl,
        SHADOW_DATABASE_URL: shadowDatabaseUrl,
      },
      windowsHide: true,
    },
  )
}

test("Prisma config keeps the shadow URL optional", () => {
  const result = runConfigCheck(
    {},
    "if (config.datasource.shadowDatabaseUrl !== undefined) process.exit(2)",
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
})

test("Prisma config accepts distinct main and shadow databases", () => {
  const result = runConfigCheck(
    { shadowDatabaseUrl: SHADOW_URL },
    "if (config.datasource.shadowDatabaseUrl === undefined) process.exit(2)",
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
})

test("Prisma config rejects the same logical database without exposing URLs", () => {
  const sameDatabaseUrl =
    "postgres://other-user:other-synthetic-password@127.0.0.1:55432/projekt_space_dev?schema=other"
  const result = runConfigCheck({ shadowDatabaseUrl: sameDatabaseUrl })

  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /DATABASE_URL and SHADOW_DATABASE_URL must identify different databases/,
  )
  assert.doesNotMatch(result.stderr, /synthetic-password/)
  assert.equal(result.stdout, "")
})

test("Prisma config uses the migration identity only when configured", () => {
  const runtimeResult = runConfigCheck(
    {},
    `if (config.datasource.url !== ${JSON.stringify(MAIN_URL)}) process.exit(2)`,
  )
  const migrationResult = runConfigCheck(
    { migrationDatabaseUrl: MIGRATION_URL },
    `if (config.datasource.url !== ${JSON.stringify(MIGRATION_URL)}) process.exit(2)`,
  )

  assert.equal(runtimeResult.status, 0)
  assert.equal(migrationResult.status, 0)
  assert.equal(runtimeResult.stdout, "")
  assert.equal(migrationResult.stdout, "")
})

test("Prisma config rejects a migration URL for another database", () => {
  const wrongDatabaseUrl = MIGRATION_URL.replace(
    "projekt_space_dev",
    "unexpected_database",
  )
  const result = runConfigCheck({
    migrationDatabaseUrl: wrongDatabaseUrl,
    shadowDatabaseUrl: SHADOW_URL,
  })

  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /DATABASE_URL and MIGRATION_DATABASE_URL must identify the same database/,
  )
  assert.doesNotMatch(result.stderr, /synthetic-password/)
  assert.equal(result.stdout, "")
})

test("Prisma config keeps migration and shadow targets separate", () => {
  const result = runConfigCheck({
    migrationDatabaseUrl: MIGRATION_URL,
    shadowDatabaseUrl: MAIN_URL,
  })

  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /DATABASE_URL and SHADOW_DATABASE_URL must identify different databases/,
  )
  assert.doesNotMatch(result.stderr, /synthetic-password/)
  assert.equal(result.stdout, "")
})
