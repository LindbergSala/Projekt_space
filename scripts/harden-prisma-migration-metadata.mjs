import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import pg from "pg"

import {
  SetupError,
  parseCompatibleMigrationDatabaseUrl,
} from "./setup-local-db-role.mjs"

const { Client } = pg

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const ENV_LOCAL_PATH = path.join(ROOT_DIRECTORY, ".env.local")
const DATABASE_NAME = "projekt_space_dev"
const MIGRATION_ROLE = "projekt_space_migrator"
const APP_ROLE = "projekt_space_app"
const CONNECTION_TIMEOUT_MS = 5_000
const QUERY_TIMEOUT_MS = 5_000

export class MetadataHardeningError extends Error {}

function fail(message) {
  throw new MetadataHardeningError(message)
}

async function loadMigrationDatabaseUrl() {
  let source

  try {
    source = await readFile(ENV_LOCAL_PATH, "utf8")
  } catch {
    fail("The local migration credential file could not be read.")
  }

  const parsed = dotenv.parse(source)
  const configuredValue = process.env.MIGRATION_DATABASE_URL ??
    parsed.MIGRATION_DATABASE_URL

  if (typeof configuredValue !== "string" || configuredValue.length === 0) {
    fail("MIGRATION_DATABASE_URL is missing.")
  }

  return configuredValue
}

function defaultCreateClient(migrationDatabaseUrl) {
  return new Client({
    connectionString: migrationDatabaseUrl,
    application_name: "projekt-space-migration-metadata-hardener",
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  })
}

async function inspectMetadataTable(client) {
  const result = await client.query(
    `SELECT owner_role.rolname AS owner_name,
            class_entry.relkind AS object_type
       FROM pg_catalog.pg_class AS class_entry
       JOIN pg_catalog.pg_namespace AS namespace_entry
         ON namespace_entry.oid = class_entry.relnamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = class_entry.relowner
      WHERE namespace_entry.nspname = 'public'
        AND class_entry.relname = '_prisma_migrations'`,
  )

  if (result.rowCount === 0) {
    return null
  }

  if (
    result.rowCount !== 1 ||
    result.rows[0].owner_name !== MIGRATION_ROLE ||
    result.rows[0].object_type !== "r"
  ) {
    fail("Prisma migration metadata has an unexpected owner or object type.")
  }

  return result.rows[0]
}

async function verifyRuntimePrivilegesRemoved(client) {
  const result = await client.query(
    `SELECT
       (
         SELECT count(*)::integer
           FROM pg_catalog.pg_class AS class_entry
           CROSS JOIN LATERAL aclexplode(class_entry.relacl) AS privileges
          WHERE class_entry.oid = 'public._prisma_migrations'::regclass
            AND privileges.grantee = (
              SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
            )
       ) AS direct_privilege_count,
       has_table_privilege($1, 'public._prisma_migrations', 'SELECT') AS can_select,
       has_table_privilege($1, 'public._prisma_migrations', 'INSERT') AS can_insert,
       has_table_privilege($1, 'public._prisma_migrations', 'UPDATE') AS can_update,
       has_table_privilege($1, 'public._prisma_migrations', 'DELETE') AS can_delete,
       has_table_privilege($1, 'public._prisma_migrations', 'TRUNCATE') AS can_truncate,
       has_table_privilege($1, 'public._prisma_migrations', 'REFERENCES') AS can_reference,
       has_table_privilege($1, 'public._prisma_migrations', 'TRIGGER') AS can_trigger,
       has_table_privilege($1, 'public._prisma_migrations', 'MAINTAIN') AS can_maintain`,
    [APP_ROLE],
  )
  const permissions = result.rows[0]
  const hasEffectivePrivilege = Object.entries(permissions ?? {}).some(
    ([name, value]) => name !== "direct_privilege_count" && value === true,
  )

  if (
    permissions?.direct_privilege_count !== 0 ||
    hasEffectivePrivilege
  ) {
    fail("The runtime role still has Prisma migration metadata privileges.")
  }
}

export async function hardenPrismaMigrationMetadata({
  migrationDatabaseUrl,
  createClient = defaultCreateClient,
} = {}) {
  const configuredUrl = migrationDatabaseUrl ?? await loadMigrationDatabaseUrl()
  parseCompatibleMigrationDatabaseUrl(configuredUrl)

  const client = createClient(configuredUrl)
  let transactionOpen = false

  try {
    await client.connect()
    await client.query("BEGIN")
    transactionOpen = true

    const identityResult = await client.query(
      "SELECT current_user AS user_name, current_database() AS database_name",
    )
    const identity = identityResult.rows[0]

    if (
      identity?.user_name !== MIGRATION_ROLE ||
      identity?.database_name !== DATABASE_NAME
    ) {
      fail("Migration metadata hardening reached an unexpected database identity.")
    }

    const metadataTable = await inspectMetadataTable(client)
    if (metadataTable === null) {
      await client.query("COMMIT")
      transactionOpen = false
      return { tableExists: false, revoked: false }
    }

    await client.query(
      `LOCK TABLE public."_prisma_migrations" IN ACCESS EXCLUSIVE MODE`,
    )
    await inspectMetadataTable(client)
    await client.query(
      `REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM projekt_space_app`,
    )
    await verifyRuntimePrivilegesRemoved(client)

    await client.query("COMMIT")
    transactionOpen = false
    return { tableExists: true, revoked: true }
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => {})
      transactionOpen = false
    }
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

export function sanitizedHardeningFailure(error) {
  if (error instanceof MetadataHardeningError || error instanceof SetupError) {
    return error.message
  }

  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "unknown"

  return `Migration metadata hardening failed (PostgreSQL code ${code}).`
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === MODULE_PATH
}

if (isDirectExecution()) {
  try {
    const result = await hardenPrismaMigrationMetadata()
    process.stdout.write(
      result.tableExists
        ? "Prisma migration metadata: runtime privileges revoked and verified.\n"
        : "Prisma migration metadata: table absent; no hardening required.\n",
    )
  } catch (error) {
    process.stderr.write(`Hardening failed: ${sanitizedHardeningFailure(error)}\n`)
    process.exitCode = 1
  }
}
