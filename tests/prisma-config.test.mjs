import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const CONFIG_PATH = path.join(ROOT_DIRECTORY, "prisma.config.mjs")
const CONFIG_URL = pathToFileURL(
  CONFIG_PATH,
).href
const MAIN_URL =
  "postgresql://app:synthetic-password@127.0.0.1:55432/projekt_space_dev"
const MIGRATION_URL =
  "postgresql://migrator:independent-synthetic-password@127.0.0.1:55432/projekt_space_dev"
const SHADOW_URL =
  "postgresql://app:synthetic-password@127.0.0.1:55432/projekt_space_shadow"
const NEON_RUNTIME_URL =
  "postgresql://app:synthetic-runtime-password@ep-cool-darkness-123456-pooler.eu-central-1.aws.neon.tech/projekt_space?sslmode=require"
const NEON_MIGRATION_URL =
  "postgresql://migrator:synthetic-migration-password@ep-cool-darkness-123456.eu-central-1.aws.neon.tech/projekt_space?sslmode=require"

function runConfigCheck({
  databaseUrl = MAIN_URL,
  migrationDatabaseUrl = "",
  shadowDatabaseUrl = "",
  loadThroughPrisma = false,
} = {}, expression = "") {
  const loadConfig = loadThroughPrisma
    ? `const { loadConfigFromFile } = await import("@prisma/config");
       const loaded = await loadConfigFromFile({
         configFile: ${JSON.stringify(CONFIG_PATH)},
         configRoot: ${JSON.stringify(ROOT_DIRECTORY)},
       });
       if (loaded.error) throw loaded.error.error;
       const config = loaded.config;`
    : `const { default: config } = await import(${JSON.stringify(CONFIG_URL)});`

  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `${loadConfig} ${expression}`,
    ],
    {
      encoding: "utf8",
      cwd: ROOT_DIRECTORY,
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

test("Prisma's config loader preserves the schema and selected database URLs", () => {
  for (const urls of [
    {},
    { shadowDatabaseUrl: SHADOW_URL },
    { migrationDatabaseUrl: MIGRATION_URL, shadowDatabaseUrl: SHADOW_URL },
  ]) {
    const expectedDatasource = {
      url: urls.migrationDatabaseUrl ?? MAIN_URL,
      ...(urls.shadowDatabaseUrl === undefined
        ? {}
        : { shadowDatabaseUrl: urls.shadowDatabaseUrl }),
    }
    const result = runConfigCheck(
      { ...urls, loadThroughPrisma: true },
      `const { default: assert } = await import("node:assert/strict");
       assert.equal(loaded.resolvedPath, ${JSON.stringify(CONFIG_PATH)});
       assert.equal(config.schema, ${JSON.stringify(path.join(ROOT_DIRECTORY, "prisma/schema.prisma"))});
       assert.deepEqual(config.datasource, ${JSON.stringify(expectedDatasource)});`,
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "")
    assert.equal(result.stderr, "")
  }
})

test("Prisma's config loader rejects incompatible targets without leaking URLs", () => {
  const cases = [
    {
      migrationDatabaseUrl: MIGRATION_URL.replace(
        "projekt_space_dev",
        "unexpected_database",
      ),
      shadowDatabaseUrl: SHADOW_URL,
      message: /DATABASE_URL and MIGRATION_DATABASE_URL must identify the same database/,
    },
    {
      migrationDatabaseUrl: MIGRATION_URL,
      shadowDatabaseUrl: MAIN_URL,
      message: /DATABASE_URL and SHADOW_DATABASE_URL must identify different databases/,
    },
  ]

  for (const { message, ...urls } of cases) {
    const result = runConfigCheck({ ...urls, loadThroughPrisma: true })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
    assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\/|synthetic-password/)
    assert.equal(result.stdout, "")
  }
})

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

test("Prisma config accepts the documented Neon pooler and direct endpoint pair", () => {
  const result = runConfigCheck({
    databaseUrl: NEON_RUNTIME_URL,
    migrationDatabaseUrl: NEON_MIGRATION_URL,
  }, `if (config.datasource.url !== ${JSON.stringify(NEON_MIGRATION_URL)}) process.exit(2)`)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
})

test("Prisma config rejects unrelated Neon endpoint identities", () => {
  const secret = "never-print-this-neon-secret"
  const unrelatedUrl = NEON_MIGRATION_URL
    .replace("synthetic-migration-password", secret)
    .replace("ep-cool-darkness-123456", "ep-other-branch-654321")
  const result = runConfigCheck({
    databaseUrl: NEON_RUNTIME_URL,
    migrationDatabaseUrl: unrelatedUrl,
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /one Neon endpoint/)
  assert.doesNotMatch(result.stderr, new RegExp(secret))
  assert.equal(result.stdout, "")
})

test("Prisma config rejects a Neon database-name mismatch", () => {
  const result = runConfigCheck({
    databaseUrl: NEON_RUNTIME_URL,
    migrationDatabaseUrl: NEON_MIGRATION_URL.replace(
      "/projekt_space?",
      "/unexpected_database?",
    ),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must identify the same database/)
  assert.doesNotMatch(result.stderr, /synthetic-(?:runtime|migration)-password/)
  assert.equal(result.stdout, "")
})

test("Prisma config rejects malformed database URLs without exposing them", () => {
  const secret = "never-print-this-malformed-secret"
  const result = runConfigCheck({
    databaseUrl: `not-a-postgres-url-${secret}`,
    migrationDatabaseUrl: NEON_MIGRATION_URL,
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /DATABASE_URL must be a valid PostgreSQL URL/)
  assert.doesNotMatch(result.stderr, new RegExp(secret))
  assert.equal(result.stdout, "")
})

test("Prisma config rejects ambiguous or reversed Neon endpoint pairs", () => {
  const cases = [
    {
      databaseUrl: NEON_RUNTIME_URL,
      migrationDatabaseUrl: NEON_MIGRATION_URL.replace(
        "ep-cool-darkness-123456.",
        "ep-cool-darkness-123456-pooler.",
      ),
    },
    {
      databaseUrl: NEON_RUNTIME_URL.replace("-pooler", ""),
      migrationDatabaseUrl: NEON_MIGRATION_URL,
    },
    {
      databaseUrl: NEON_RUNTIME_URL.replace(
        "ep-cool-darkness-123456-pooler",
        "ep-cool-darkness-123456-pooler-pooler",
      ),
      migrationDatabaseUrl: NEON_MIGRATION_URL.replace(
        "ep-cool-darkness-123456",
        "ep-cool-darkness-123456-pooler",
      ),
    },
  ]

  for (const urls of cases) {
    const result = runConfigCheck(urls)

    assert.notEqual(result.status, 0)
    assert.doesNotMatch(
      result.stderr,
      /synthetic-(?:runtime|migration)-password/,
    )
    assert.equal(result.stdout, "")
  }
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
