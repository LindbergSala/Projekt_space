import { randomBytes } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import {
  access,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import pg from "pg"

const { Client } = pg

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const ADMIN_ENV_PATH = path.join(ROOT_DIRECTORY, ".env.postgres.local")
const APP_ENV_PATH = path.join(ROOT_DIRECTORY, ".env.local")

const DATABASE_HOST = "127.0.0.1"
const DATABASE_PORT = 55432
const DATABASE_NAME = "projekt_space_dev"
const SHADOW_DATABASE_NAME = "projekt_space_shadow"
const ADMIN_ROLE = "projekt_space_admin"
const MIGRATION_ROLE = "projekt_space_migrator"
const APP_ROLE = "projekt_space_app"
const EXAMPLE_PASSWORD = "replace-with-generated-password"
const CONNECTION_TIMEOUT_MS = 5_000
const QUERY_TIMEOUT_MS = 5_000
const PROBE_TABLE = "public.projekt_space_role_permission_probe"
const MIGRATION_PROBE_TABLE =
  "public.projekt_space_migration_permission_probe"
const MIGRATION_PROBE_SEQUENCE =
  "public.projekt_space_migration_sequence_probe"
const APP_TABLE_PRIVILEGES = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"])
const APP_SEQUENCE_PRIVILEGES = new Set(["USAGE", "SELECT"])

export class SetupError extends Error {}

function fail(message) {
  throw new SetupError(message)
}

function report(message) {
  process.stdout.write(`${message}\n`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function parseUniqueEnvValue(source, name, { required = false } = {}) {
  const escapedName = escapeRegExp(name)
  const assignment = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${escapedName}[ \\t]*=`,
  )
  const possibleAssignment = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${escapedName}(?:[ \\t]|=|$)`,
  )
  let assignmentCount = 0

  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = line.trimStart()

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }

    if (assignment.test(line)) {
      assignmentCount += 1
    } else if (possibleAssignment.test(line)) {
      fail(`Unsupported ${name} assignment syntax.`)
    }
  }

  if (assignmentCount > 1) {
    fail(`Multiple ${name} assignments exist.`)
  }

  if (assignmentCount === 0) {
    if (required) {
      fail(`${name} is missing.`)
    }

    return null
  }

  const parsed = dotenv.parse(source)
  const value = parsed[name]

  if (typeof value !== "string") {
    fail(`${name} could not be parsed.`)
  }

  return value
}

function parseCompatibleLocalDatabaseUrl(value, {
  databaseName,
  roleName,
  variableName,
}) {
  let url

  try {
    url = new URL(value)
  } catch {
    fail(`${variableName} is not a valid URL.`)
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    fail(`${variableName} query parameters and fragments are not supported.`)
  }

  let username
  let password
  let database

  try {
    username = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    fail(`${variableName} contains invalid URL encoding.`)
  }

  const compatible =
    url.protocol === "postgresql:" &&
    url.hostname === DATABASE_HOST &&
    url.port === String(DATABASE_PORT) &&
    database === databaseName &&
    username === roleName &&
    password.length > 0

  if (!compatible) {
    fail(`${variableName} targets unexpected local database settings.`)
  }

  if (password === EXAMPLE_PASSWORD) {
    fail(`${variableName} still contains the example password.`)
  }

  return validatePasswordForNativeInput(password)
}

export function parseCompatibleDatabaseUrl(value) {
  return parseCompatibleLocalDatabaseUrl(value, {
    databaseName: DATABASE_NAME,
    roleName: APP_ROLE,
    variableName: "DATABASE_URL",
  })
}

export function parseCompatibleMigrationDatabaseUrl(value) {
  return parseCompatibleLocalDatabaseUrl(value, {
    databaseName: DATABASE_NAME,
    roleName: MIGRATION_ROLE,
    variableName: "MIGRATION_DATABASE_URL",
  })
}

export function parseCompatibleShadowDatabaseUrl(value) {
  return parseCompatibleLocalDatabaseUrl(value, {
    databaseName: SHADOW_DATABASE_NAME,
    roleName: APP_ROLE,
    variableName: "SHADOW_DATABASE_URL",
  })
}

export function validatePasswordForNativeInput(password) {
  if (typeof password !== "string" || password.length === 0) {
    fail("The database role password is empty or invalid.")
  }

  if (/[\r\n\0]/u.test(password)) {
    fail("The database role password contains unsupported control characters.")
  }

  return password
}

function createLocalDatabaseUrl(password, databaseName, roleName) {
  return (
    `postgresql://${encodeURIComponent(roleName)}:` +
    `${encodeURIComponent(password)}@${DATABASE_HOST}:${DATABASE_PORT}/` +
    encodeURIComponent(databaseName)
  )
}

export function createDatabaseUrl(password) {
  return createLocalDatabaseUrl(password, DATABASE_NAME, APP_ROLE)
}

export function createMigrationDatabaseUrl(password) {
  return createLocalDatabaseUrl(password, DATABASE_NAME, MIGRATION_ROLE)
}

export function createShadowDatabaseUrl(password) {
  return createLocalDatabaseUrl(password, SHADOW_DATABASE_NAME, APP_ROLE)
}

function appendEnvironmentValue(source, name, value) {
  const content = source ?? ""
  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const prefix = content.length === 0 || content.endsWith("\n")
    ? content
    : `${content}${newline}`

  return `${prefix}${name}=${value}${newline}`
}

export function appendDatabaseUrl(source, databaseUrl) {
  return appendEnvironmentValue(source, "DATABASE_URL", databaseUrl)
}

export function appendShadowDatabaseUrl(source, shadowDatabaseUrl) {
  return appendEnvironmentValue(
    source,
    "SHADOW_DATABASE_URL",
    shadowDatabaseUrl,
  )
}

export function appendMigrationDatabaseUrl(source, migrationDatabaseUrl) {
  return appendEnvironmentValue(
    source,
    "MIGRATION_DATABASE_URL",
    migrationDatabaseUrl,
  )
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null
    }

    fail("A required local configuration file could not be read.")
  }
}

export function createTemporaryCredentialPath(
  filePath,
  uniqueId = `${process.pid}.${randomBytes(8).toString("hex")}`,
) {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${uniqueId}.tmp`,
  )
}

function assertIgnoredPath(filePath) {
  const relativePath = path.relative(ROOT_DIRECTORY, filePath)
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    fail("The temporary credential file is outside the repository.")
  }

  assertIgnored(relativePath)
}

export async function persistCredentialFile({
  filePath,
  expectedSource,
  nextSource,
}, {
  openFile = open,
  renameFile = rename,
  removeFile = unlink,
  verifyTemporaryPathIgnored = assertIgnoredPath,
  uniqueId,
} = {}) {
  const temporaryPath = createTemporaryCredentialPath(filePath, uniqueId)
  let temporaryFile
  let ownsTemporaryFile = false
  let operationError
  let cleanupError

  try {
    const currentSource = await readOptionalFile(filePath)
    if (currentSource !== expectedSource) {
      fail("The local credential file changed before it could be updated.")
    }

    verifyTemporaryPathIgnored(temporaryPath)
    temporaryFile = await openFile(temporaryPath, "wx", 0o600)
    ownsTemporaryFile = true
    await temporaryFile.writeFile(nextSource, "utf8")
    await temporaryFile.close()
    temporaryFile = undefined

    const sourceBeforeRename = await readOptionalFile(filePath)
    if (sourceBeforeRename !== expectedSource) {
      fail("The local credential file changed while it was being updated.")
    }

    await renameFile(temporaryPath, filePath)
    ownsTemporaryFile = false

    const persistedSource = await readOptionalFile(filePath)
    if (persistedSource !== nextSource) {
      fail("The saved local credential file could not be verified.")
    }
  } catch (error) {
    operationError = error
  } finally {
    if (temporaryFile) {
      try {
        await temporaryFile.close()
      } catch (error) {
        cleanupError ??= error
      }
    }

    if (ownsTemporaryFile) {
      try {
        await removeFile(temporaryPath)
      } catch (error) {
        cleanupError ??= error
      }
    }
  }

  if (cleanupError) {
    fail("A task-owned temporary credential file could not be removed safely.")
  }

  if (operationError instanceof SetupError) {
    throw operationError
  }

  if (operationError) {
    fail("The local database credential could not be persisted safely.")
  }
}

export async function reconcileRoleSetup({
  appSource,
  existingRole,
  authenticateExistingRole,
  verifyExistingRole,
  persistCredentials,
  createNewRole,
  verifyNewRole,
  generatePassword = () => randomBytes(32).toString("base64url"),
}) {
  const databaseUrl = parseUniqueEnvValue(appSource ?? "", "DATABASE_URL")
  let password = databaseUrl === null
    ? null
    : parseCompatibleDatabaseUrl(databaseUrl)

  if (existingRole) {
    if (password === null) {
      fail("The application role exists without compatible local credentials.")
    }

    await authenticateExistingRole(password)
    await verifyExistingRole(existingRole)

    return { created: false, credentialsWritten: false }
  }

  if (password === null) {
    password = generatePassword()

    if (typeof password !== "string" || password.length === 0) {
      fail("A secure application password could not be generated.")
    }

    validatePasswordForNativeInput(password)

    const nextSource = appendDatabaseUrl(
      appSource,
      createDatabaseUrl(password),
    )
    await persistCredentials({
      expectedSource: appSource,
      nextSource,
    })
  }

  await createNewRole(password)
  await verifyNewRole(password)

  return { created: true, credentialsWritten: databaseUrl === null }
}

export async function reconcileMigrationRoleSetup({
  appSource,
  applicationPassword,
  existingRole,
  authenticateExistingRole,
  verifyExistingRole,
  persistCredentials,
  createNewRole,
  verifyNewRole,
  generatePassword = () => randomBytes(32).toString("base64url"),
}) {
  const migrationDatabaseUrl = parseUniqueEnvValue(
    appSource ?? "",
    "MIGRATION_DATABASE_URL",
  )
  let password = migrationDatabaseUrl === null
    ? null
    : parseCompatibleMigrationDatabaseUrl(migrationDatabaseUrl)

  if (password === applicationPassword) {
    fail("The migration and application roles must use different credentials.")
  }

  if (existingRole) {
    if (password === null) {
      fail("The migration role exists without compatible local credentials.")
    }

    await authenticateExistingRole(password)
    await verifyExistingRole(existingRole)

    return { created: false, credentialsWritten: false }
  }

  if (password === null) {
    password = generatePassword()

    if (typeof password !== "string" || password.length === 0) {
      fail("A secure migration password could not be generated.")
    }

    validatePasswordForNativeInput(password)
    if (password === applicationPassword) {
      fail("The migration and application roles must use different credentials.")
    }

    const nextSource = appendMigrationDatabaseUrl(
      appSource,
      createMigrationDatabaseUrl(password),
    )
    await persistCredentials({
      expectedSource: appSource,
      nextSource,
    })
  }

  await createNewRole(password)
  await verifyNewRole(password)

  return {
    created: true,
    credentialsWritten: migrationDatabaseUrl === null,
  }
}

export async function reconcileShadowCredential({
  appSource,
  password,
  persistCredentials,
}) {
  const shadowDatabaseUrl = parseUniqueEnvValue(
    appSource ?? "",
    "SHADOW_DATABASE_URL",
  )

  if (shadowDatabaseUrl !== null) {
    const shadowPassword = parseCompatibleShadowDatabaseUrl(shadowDatabaseUrl)

    if (shadowPassword !== password) {
      fail("DATABASE_URL and SHADOW_DATABASE_URL use different credentials.")
    }

    return { credentialsWritten: false }
  }

  const nextSource = appendShadowDatabaseUrl(
    appSource,
    createShadowDatabaseUrl(password),
  )
  await persistCredentials({
    expectedSource: appSource,
    nextSource,
  })

  return { credentialsWritten: true }
}

export async function reconcileShadowDatabase({
  existingOwner,
  createDatabase,
  verifyCreatedDatabase,
}) {
  if (existingOwner !== null) {
    if (existingOwner !== APP_ROLE) {
      fail("The shadow database has an unexpected owner.")
    }

    return { created: false }
  }

  await createDatabase()
  await verifyCreatedDatabase()

  return { created: true }
}

function assertIgnored(relativePath) {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
    cwd: ROOT_DIRECTORY,
    stdio: "ignore",
    windowsHide: true,
  })

  if (result.status !== 0) {
    fail(`${relativePath} is not ignored by Git; no credentials were written.`)
  }
}

function assertUntracked(relativePath) {
  const result = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", relativePath],
    {
      cwd: ROOT_DIRECTORY,
      stdio: "ignore",
      windowsHide: true,
    },
  )

  if (result.status === 0) {
    fail(`${relativePath} is tracked by Git; no credentials were written.`)
  }

  if (result.status !== 1) {
    fail(`The Git tracking state for ${relativePath} could not be verified.`)
  }
}

function clientOptions(user, password, database = DATABASE_NAME) {
  return {
    host: DATABASE_HOST,
    port: DATABASE_PORT,
    database,
    user,
    password,
    ssl: false,
    application_name: "projekt-space-role-setup",
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  }
}

async function closeClient(client) {
  try {
    await client.end()
  } catch {
    // Preserve the original result while still attempting to release sockets.
  }
}

async function connectClient(user, password, database = DATABASE_NAME) {
  const client = new Client(clientOptions(user, password, database))

  try {
    await client.connect()
    return client
  } catch (error) {
    await closeClient(client)
    throw error
  }
}

async function verifyIdentity(
  client,
  expectedUser,
  expectedDatabase = DATABASE_NAME,
) {
  const result = await client.query(
    "SELECT current_user AS user_name, current_database() AS database_name",
  )
  const identity = result.rows[0]

  if (
    identity?.user_name !== expectedUser ||
    identity?.database_name !== expectedDatabase
  ) {
    fail("Database identity verification failed.")
  }
}

async function verifyBasicApplicationAccess(password) {
  const appClient = await connectClient(APP_ROLE, password)

  try {
    await verifyIdentity(appClient, APP_ROLE)
    const result = await appClient.query("SELECT 1 AS probe")

    if (result.rows[0]?.probe !== 1) {
      fail("Application SELECT verification failed.")
    }
  } finally {
    await closeClient(appClient)
  }
}

async function verifyShadowDatabaseAccess(password) {
  const appClient = await connectClient(
    APP_ROLE,
    password,
    SHADOW_DATABASE_NAME,
  )

  try {
    await verifyIdentity(appClient, APP_ROLE, SHADOW_DATABASE_NAME)
    const result = await appClient.query(
      `SELECT
         has_database_privilege(current_user, current_database(), 'CREATE')
           AS database_create,
         has_schema_privilege(current_user, 'public', 'CREATE')
           AS schema_create`,
    )
    const permissions = result.rows[0]

    if (!permissions?.database_create || !permissions?.schema_create) {
      fail("The application role cannot reset its shadow database.")
    }
  } finally {
    await closeClient(appClient)
  }
}

async function getRole(adminClient, roleName = APP_ROLE) {
  const result = await adminClient.query(
    `SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
       FROM pg_catalog.pg_roles
      WHERE rolname = $1`,
    [roleName],
  )

  return result.rows[0] ?? null
}

async function getShadowDatabaseOwner(adminClient) {
  const result = await adminClient.query(
    `SELECT owner_role.rolname AS owner_name
       FROM pg_catalog.pg_database AS database_entry
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = database_entry.datdba
      WHERE database_entry.datname = $1`,
    [SHADOW_DATABASE_NAME],
  )

  return result.rows[0]?.owner_name ?? null
}

async function ensureShadowDatabase(adminClient) {
  const existingOwner = await getShadowDatabaseOwner(adminClient)

  return reconcileShadowDatabase({
    existingOwner,
    createDatabase: async () => {
      await adminClient.query(
        `CREATE DATABASE ${SHADOW_DATABASE_NAME} OWNER ${APP_ROLE}`,
      )
    },
    verifyCreatedDatabase: async () => {
      const owner = await getShadowDatabaseOwner(adminClient)
      if (owner !== APP_ROLE) {
        fail("The new shadow database owner could not be verified.")
      }
    },
  })
}

async function inspectPublicPrivileges(adminClient) {
  const result = await adminClient.query(
    `SELECT 'database' AS object_type, privilege_type
       FROM pg_catalog.pg_database AS database_entry,
            LATERAL aclexplode(
              COALESCE(
                database_entry.datacl,
                acldefault('d', database_entry.datdba)
              )
            ) AS privileges
      WHERE database_entry.datname = $1
        AND privileges.grantee = 0
      UNION ALL
     SELECT 'schema' AS object_type, privilege_type
       FROM pg_catalog.pg_namespace AS namespace_entry,
            LATERAL aclexplode(
              COALESCE(
                namespace_entry.nspacl,
                acldefault('n', namespace_entry.nspowner)
              )
            ) AS privileges
      WHERE namespace_entry.nspname = 'public'
        AND privileges.grantee = 0
      ORDER BY object_type, privilege_type`,
    [DATABASE_NAME],
  )

  const databasePrivileges = result.rows
    .filter((row) => row.object_type === "database")
    .map((row) => row.privilege_type)
  const schemaPrivileges = result.rows
    .filter((row) => row.object_type === "schema")
    .map((row) => row.privilege_type)

  if (databasePrivileges.includes("CREATE")) {
    fail("Permission conflict: PUBLIC has CREATE on the target database.")
  }

  if (schemaPrivileges.includes("CREATE")) {
    fail("Permission conflict: PUBLIC has CREATE on the public schema.")
  }

  return { databasePrivileges, schemaPrivileges }
}

export function assertRestrictedLoginRole(role, roleDescription) {
  const restricted =
    role?.rolcanlogin === true &&
    role.rolsuper === false &&
    role.rolcreatedb === false &&
    role.rolcreaterole === false &&
    role.rolreplication === false &&
    role.rolbypassrls === false

  if (!restricted) {
    fail(`The existing ${roleDescription} role has unexpected attributes.`)
  }
}

async function assertCompatibleRole(adminClient, role) {
  assertRestrictedLoginRole(role, "application")

  const memberships = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       JOIN pg_catalog.pg_roles AS member_role
         ON member_role.oid = membership.member
      WHERE member_role.rolname = $1
      LIMIT 1`,
    [APP_ROLE],
  )

  if (memberships.rowCount !== 0) {
    fail("The application role belongs to another role.")
  }

  const ownedDatabases = await adminClient.query(
    `SELECT datname
       FROM pg_catalog.pg_database
      WHERE datdba = $1
      ORDER BY datname`,
    [role.oid],
  )
  const unexpectedDatabase = ownedDatabases.rows.find(
    (row) => row.datname !== SHADOW_DATABASE_NAME,
  )

  if (unexpectedDatabase || ownedDatabases.rowCount > 1) {
    fail("The application role owns an unexpected database.")
  }

  const ownedSchemas = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_namespace
      WHERE nspowner = $1
      LIMIT 1`,
    [role.oid],
  )

  if (ownedSchemas.rowCount !== 0) {
    fail("The application role owns an unexpected schema.")
  }

  const defaultPrivileges = await adminClient.query(
    `SELECT creator.rolname AS creator_role,
            namespace_entry.nspname AS schema_name,
            defaults.defaclobjtype AS object_type,
            privileges.privilege_type,
            privileges.is_grantable
       FROM pg_catalog.pg_default_acl AS defaults
       JOIN pg_catalog.pg_roles AS creator
         ON creator.oid = defaults.defaclrole
       LEFT JOIN pg_catalog.pg_namespace AS namespace_entry
         ON namespace_entry.oid = defaults.defaclnamespace,
            LATERAL aclexplode(defaults.defaclacl) AS privileges
      WHERE privileges.grantee = $1`,
    [role.oid],
  )

  for (const grant of defaultPrivileges.rows) {
    const expectedPrivileges = grant.object_type === "r"
      ? APP_TABLE_PRIVILEGES
      : grant.object_type === "S"
        ? APP_SEQUENCE_PRIVILEGES
        : null
    const expected =
      grant.creator_role === MIGRATION_ROLE &&
      grant.schema_name === "public" &&
      expectedPrivileges?.has(grant.privilege_type) === true &&
      grant.is_grantable === false

    if (!expected) {
      fail("The application role has unexpected default privileges.")
    }
  }

  const objectPrivileges = await adminClient.query(
    `SELECT namespace_entry.nspname AS schema_name,
            class_entry.relkind AS object_type,
            owner_role.rolname AS owner_name,
            privileges.grantee,
            privileges.privilege_type,
            privileges.is_grantable
       FROM pg_catalog.pg_class AS class_entry
       JOIN pg_catalog.pg_namespace AS namespace_entry
         ON namespace_entry.oid = class_entry.relnamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = class_entry.relowner,
            LATERAL aclexplode(class_entry.relacl) AS privileges
      WHERE namespace_entry.nspname NOT IN ('pg_catalog', 'information_schema')
        AND privileges.grantee IN (0, $1)`,
    [role.oid],
  )

  for (const grant of objectPrivileges.rows) {
    const expectedPrivileges = grant.object_type === "S"
      ? APP_SEQUENCE_PRIVILEGES
      : APP_TABLE_PRIVILEGES
    const expected =
      grant.grantee === role.oid &&
      grant.schema_name === "public" &&
      grant.owner_name === MIGRATION_ROLE &&
      expectedPrivileges.has(grant.privilege_type) &&
      grant.is_grantable === false

    if (!expected) {
      fail("Unexpected application-visible object privileges exist.")
    }
  }
}

async function verifyRolePermissions(adminClient, role) {
  await assertCompatibleRole(adminClient, role)

  const effective = await adminClient.query(
    `SELECT
       has_database_privilege($1, $2, 'CONNECT') AS database_connect,
       has_database_privilege($1, $2, 'CREATE') AS database_create,
       has_database_privilege($1, $2, 'TEMP') AS database_temporary,
       has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege($1, 'public', 'CREATE') AS schema_create`,
    [APP_ROLE, DATABASE_NAME],
  )
  const permissions = effective.rows[0]

  if (!permissions?.database_connect || !permissions?.schema_usage) {
    fail("Required application role access is missing.")
  }

  if (permissions.database_create || permissions.schema_create) {
    fail("The application role has unexpected effective CREATE access.")
  }

  const directGrants = await adminClient.query(
    `SELECT
       EXISTS(
         SELECT 1
           FROM pg_catalog.pg_database AS database_entry,
                LATERAL aclexplode(database_entry.datacl) AS privileges
          WHERE database_entry.datname = $2
            AND privileges.grantee = $1
            AND privileges.privilege_type = 'CONNECT'
       ) AS direct_connect,
       EXISTS(
         SELECT 1
           FROM pg_catalog.pg_namespace AS namespace_entry,
                LATERAL aclexplode(namespace_entry.nspacl) AS privileges
          WHERE namespace_entry.nspname = 'public'
            AND privileges.grantee = $1
            AND privileges.privilege_type = 'USAGE'
       ) AS direct_usage`,
    [role.oid, DATABASE_NAME],
  )

  if (!directGrants.rows[0]?.direct_connect || !directGrants.rows[0]?.direct_usage) {
    fail("Required direct application role grants are missing.")
  }

  return permissions
}

function setsEqual(actual, expected) {
  return actual.size === expected.size &&
    [...actual].every((value) => expected.has(value))
}

export function assertExpectedMigrationDefaultPrivileges(rows) {
  const grantsByObjectType = new Map([
    ["r", new Set()],
    ["S", new Set()],
  ])
  const seenObjectTypes = new Set()

  for (const row of rows) {
    if (
      row.schema_name !== "public" ||
      !grantsByObjectType.has(row.object_type)
    ) {
      fail("The migration role has unexpected default-privilege targets.")
    }

    seenObjectTypes.add(row.object_type)

    if (row.grantee_role === MIGRATION_ROLE) {
      continue
    }

    if (
      row.grantee_role !== APP_ROLE ||
      row.is_grantable !== false
    ) {
      fail("The migration role has unexpected default-privilege recipients.")
    }

    grantsByObjectType.get(row.object_type).add(row.privilege_type)
  }

  if (
    seenObjectTypes.size !== 2 ||
    !setsEqual(grantsByObjectType.get("r"), APP_TABLE_PRIVILEGES) ||
    !setsEqual(grantsByObjectType.get("S"), APP_SEQUENCE_PRIVILEGES)
  ) {
    fail("The migration role default privileges are incomplete or unexpected.")
  }
}

async function assertCompatibleMigrationRole(adminClient, role) {
  assertRestrictedLoginRole(role, "migration")

  const memberships = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       JOIN pg_catalog.pg_roles AS member_role
         ON member_role.oid = membership.member
      WHERE member_role.rolname = $1
      LIMIT 1`,
    [MIGRATION_ROLE],
  )

  if (memberships.rowCount !== 0) {
    fail("The migration role belongs to another role.")
  }

  const ownedDatabases = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_database
      WHERE datdba = $1
      LIMIT 1`,
    [role.oid],
  )
  const ownedSchemas = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_namespace
      WHERE nspowner = $1
      LIMIT 1`,
    [role.oid],
  )
  const unexpectedOwnedObjects = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_class AS class_entry
       JOIN pg_catalog.pg_namespace AS namespace_entry
         ON namespace_entry.oid = class_entry.relnamespace
      WHERE class_entry.relowner = $1
        AND namespace_entry.nspname <> 'public'
        AND namespace_entry.nspname NOT LIKE 'pg_temp_%'
      LIMIT 1`,
    [role.oid],
  )

  if (
    ownedDatabases.rowCount !== 0 ||
    ownedSchemas.rowCount !== 0 ||
    unexpectedOwnedObjects.rowCount !== 0
  ) {
    fail("The migration role owns an unexpected database, schema, or object.")
  }

  const databaseGrants = await adminClient.query(
    `SELECT database_entry.datname AS database_name,
            privileges.privilege_type,
            privileges.is_grantable
       FROM pg_catalog.pg_database AS database_entry,
            LATERAL aclexplode(database_entry.datacl) AS privileges
      WHERE privileges.grantee = $1`,
    [role.oid],
  )

  if (
    databaseGrants.rowCount !== 1 ||
    databaseGrants.rows[0].database_name !== DATABASE_NAME ||
    databaseGrants.rows[0].privilege_type !== "CONNECT" ||
    databaseGrants.rows[0].is_grantable !== false
  ) {
    fail("The migration role has unexpected direct database privileges.")
  }

  const schemaGrants = await adminClient.query(
    `SELECT namespace_entry.nspname AS schema_name,
            privileges.privilege_type,
            privileges.is_grantable
       FROM pg_catalog.pg_namespace AS namespace_entry,
            LATERAL aclexplode(namespace_entry.nspacl) AS privileges
      WHERE privileges.grantee = $1`,
    [role.oid],
  )
  const schemaPrivilegeNames = new Set(
    schemaGrants.rows.map((grant) => grant.privilege_type),
  )
  const validSchemaGrants = schemaGrants.rows.every(
    (grant) =>
      grant.schema_name === "public" &&
      grant.is_grantable === false,
  )

  if (
    !validSchemaGrants ||
    !setsEqual(schemaPrivilegeNames, new Set(["USAGE", "CREATE"]))
  ) {
    fail("The migration role has unexpected direct schema privileges.")
  }

  const defaultPrivileges = await adminClient.query(
    `SELECT namespace_entry.nspname AS schema_name,
            defaults.defaclobjtype AS object_type,
            COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee_role,
            privileges.privilege_type,
            privileges.is_grantable
       FROM pg_catalog.pg_default_acl AS defaults
       LEFT JOIN pg_catalog.pg_namespace AS namespace_entry
         ON namespace_entry.oid = defaults.defaclnamespace
       CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privileges
       LEFT JOIN pg_catalog.pg_roles AS grantee_role
         ON grantee_role.oid = privileges.grantee
      WHERE defaults.defaclrole = $1`,
    [role.oid],
  )

  assertExpectedMigrationDefaultPrivileges(defaultPrivileges.rows)
}

async function verifyMigrationRolePermissions(adminClient, role) {
  await assertCompatibleMigrationRole(adminClient, role)

  const effective = await adminClient.query(
    `SELECT
       has_database_privilege($1, $2, 'CONNECT') AS database_connect,
       has_database_privilege($1, $2, 'CREATE') AS database_create,
       has_database_privilege($1, $2, 'TEMP') AS database_temporary,
       has_database_privilege($1, $3, 'CREATE') AS shadow_database_create,
       has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege($1, 'public', 'CREATE') AS schema_create`,
    [MIGRATION_ROLE, DATABASE_NAME, SHADOW_DATABASE_NAME],
  )
  const permissions = effective.rows[0]

  if (
    !permissions?.database_connect ||
    !permissions.schema_usage ||
    !permissions.schema_create
  ) {
    fail("Required migration role access is missing.")
  }

  if (permissions.database_create || permissions.shadow_database_create) {
    fail("The migration role has unexpected database CREATE access.")
  }

  return permissions
}

async function verifyMigrationRoleRestrictedInShadow(adminPassword) {
  const shadowAdminClient = await connectClient(
    ADMIN_ROLE,
    adminPassword,
    SHADOW_DATABASE_NAME,
  )

  try {
    const result = await shadowAdminClient.query(
      `SELECT
         has_schema_privilege($1, 'public', 'CREATE') AS schema_create,
         EXISTS(
           SELECT 1
             FROM pg_catalog.pg_namespace AS namespace_entry
             JOIN pg_catalog.pg_roles AS owner_role
               ON owner_role.oid = namespace_entry.nspowner
            WHERE namespace_entry.nspname = 'public'
              AND owner_role.rolname = $1
         ) AS owns_schema`,
      [MIGRATION_ROLE],
    )

    if (result.rows[0]?.schema_create || result.rows[0]?.owns_schema) {
      fail("The migration role has unexpected shadow-schema access.")
    }
  } finally {
    await closeClient(shadowAdminClient)
  }
}

function nativeRoleSetupInput(password) {
  return [
    `SELECT current_user = '${ADMIN_ROLE}' AND current_database() = '${DATABASE_NAME}' AS expected_identity \\gset`,
    "\\if :expected_identity",
    "BEGIN;",
    `CREATE ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    `\\password ${APP_ROLE}`,
    password,
    password,
    `GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${APP_ROLE};`,
    `GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`,
    "COMMIT;",
    "\\else",
    "\\quit 3",
    "\\endif",
    "",
  ].join("\n")
}

export function createRoleWithNativeClient(
  password,
  { spawn = spawnSync, repositoryRoot = ROOT_DIRECTORY } = {},
) {
  validatePasswordForNativeInput(password)

  const args = [
    "compose",
    "--env-file",
    ".env.postgres.local",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "--set=ON_ERROR_STOP=1",
    "--username",
    ADMIN_ROLE,
    "--dbname",
    DATABASE_NAME,
  ]
  const result = spawn("docker", args, {
    cwd: repositoryRoot,
    input: nativeRoleSetupInput(password),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1_048_576,
  })
  const stdout = typeof result.stdout === "string" ? result.stdout : ""
  const stderr = typeof result.stderr === "string" ? result.stderr : ""

  if (stdout.includes(password) || stderr.includes(password)) {
    fail("The native PostgreSQL client exposed credential material in output.")
  }

  if (result.error?.code === "ETIMEDOUT") {
    fail("Native PostgreSQL role creation timed out; saved credentials were retained.")
  }

  if (result.status !== 0) {
    fail("Native PostgreSQL role creation failed; saved credentials were retained.")
  }
}

function nativeMigrationRoleSetupInput(password) {
  return [
    `SELECT current_user = '${ADMIN_ROLE}' AND current_database() = '${DATABASE_NAME}' AS expected_identity \\gset`,
    "\\if :expected_identity",
    "BEGIN;",
    `CREATE ROLE ${MIGRATION_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    `\\password ${MIGRATION_ROLE}`,
    password,
    password,
    `GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${MIGRATION_ROLE};`,
    `GRANT USAGE, CREATE ON SCHEMA public TO ${MIGRATION_ROLE};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATION_ROLE} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATION_ROLE} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
    "COMMIT;",
    "\\else",
    "\\quit 3",
    "\\endif",
    "",
  ].join("\n")
}

export function createMigrationRoleWithNativeClient(
  password,
  { spawn = spawnSync, repositoryRoot = ROOT_DIRECTORY } = {},
) {
  validatePasswordForNativeInput(password)

  const args = [
    "compose",
    "--env-file",
    ".env.postgres.local",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "--set=ON_ERROR_STOP=1",
    "--username",
    ADMIN_ROLE,
    "--dbname",
    DATABASE_NAME,
  ]
  const result = spawn("docker", args, {
    cwd: repositoryRoot,
    input: nativeMigrationRoleSetupInput(password),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1_048_576,
  })
  const stdout = typeof result.stdout === "string" ? result.stdout : ""
  const stderr = typeof result.stderr === "string" ? result.stderr : ""

  if (stdout.includes(password) || stderr.includes(password)) {
    fail("The native PostgreSQL client exposed credential material in output.")
  }

  if (result.error?.code === "ETIMEDOUT") {
    fail("Native PostgreSQL migration-role creation timed out; saved credentials were retained.")
  }

  if (result.status !== 0) {
    fail("Native PostgreSQL migration-role creation failed; saved credentials were retained.")
  }
}

async function verifyBasicMigrationAccess(password) {
  const migrationClient = await connectClient(MIGRATION_ROLE, password)

  try {
    await verifyIdentity(migrationClient, MIGRATION_ROLE)
    const result = await migrationClient.query("SELECT 1 AS probe")

    if (result.rows[0]?.probe !== 1) {
      fail("Migration-role SELECT verification failed.")
    }
  } finally {
    await closeClient(migrationClient)
  }
}

async function verifyIncorrectPasswordRejected(
  roleName = APP_ROLE,
  roleDescription = "application",
) {
  const incorrectPassword = randomBytes(32).toString("base64url")

  try {
    const client = await connectClient(roleName, incorrectPassword)
    await closeClient(client)
    fail(`An incorrect ${roleDescription} password unexpectedly succeeded.`)
  } catch (error) {
    if (error instanceof SetupError) {
      throw error
    }

    if (!error || typeof error !== "object" || error.code !== "28P01") {
      fail("Incorrect-password verification returned an unexpected failure.")
    }
  }
}

async function verifyTableCreationRejected(password, adminClient) {
  const appClient = await connectClient(APP_ROLE, password)
  let transactionOpen = false

  try {
    await appClient.query("BEGIN")
    transactionOpen = true

    try {
      await appClient.query(
        `CREATE TABLE ${PROBE_TABLE} (probe integer NOT NULL)`,
      )
      fail("Regular table creation unexpectedly succeeded.")
    } catch (error) {
      if (error instanceof SetupError) {
        throw error
      }

      if (!error || typeof error !== "object" || error.code !== "42501") {
        fail("Table-creation verification failed for an unexpected reason.")
      }
    } finally {
      if (transactionOpen) {
        await appClient.query("ROLLBACK")
        transactionOpen = false
      }
    }
  } finally {
    if (transactionOpen) {
      await appClient.query("ROLLBACK").catch(() => {})
    }
    await closeClient(appClient)
  }

  const probe = await adminClient.query(
    "SELECT to_regclass($1) IS NULL AS absent",
    [PROBE_TABLE],
  )

  if (!probe.rows[0]?.absent) {
    fail("The permission probe object was not removed.")
  }
}

async function verifyMigrationObjectCreation(password, adminClient) {
  const migrationClient = await connectClient(MIGRATION_ROLE, password)
  let transactionOpen = false

  try {
    await migrationClient.query("BEGIN")
    transactionOpen = true
    await migrationClient.query(
      `CREATE TABLE ${MIGRATION_PROBE_TABLE} (probe integer NOT NULL)`,
    )
    await migrationClient.query(`CREATE SEQUENCE ${MIGRATION_PROBE_SEQUENCE}`)

    const grants = await migrationClient.query(
      `SELECT class_entry.relkind AS object_type,
              owner_role.rolname AS owner_name,
              privileges.privilege_type,
              privileges.is_grantable
         FROM pg_catalog.pg_class AS class_entry
         JOIN pg_catalog.pg_roles AS owner_role
           ON owner_role.oid = class_entry.relowner
         CROSS JOIN LATERAL aclexplode(class_entry.relacl) AS privileges
        WHERE class_entry.oid IN (to_regclass($1), to_regclass($2))
          AND privileges.grantee = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $3
          )`,
      [MIGRATION_PROBE_TABLE, MIGRATION_PROBE_SEQUENCE, APP_ROLE],
    )
    const tablePrivileges = new Set(
      grants.rows
        .filter((grant) => grant.object_type !== "S")
        .map((grant) => grant.privilege_type),
    )
    const sequencePrivileges = new Set(
      grants.rows
        .filter((grant) => grant.object_type === "S")
        .map((grant) => grant.privilege_type),
    )
    const compatible =
      grants.rows.length > 0 &&
      grants.rows.every(
        (grant) =>
          grant.owner_name === MIGRATION_ROLE &&
          grant.is_grantable === false,
      ) &&
      setsEqual(tablePrivileges, APP_TABLE_PRIVILEGES) &&
      setsEqual(sequencePrivileges, APP_SEQUENCE_PRIVILEGES)

    if (!compatible) {
      fail("Migration object ownership or default grants were not verified.")
    }

    await migrationClient.query("ROLLBACK")
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      await migrationClient.query("ROLLBACK").catch(() => {})
    }
    await closeClient(migrationClient)
  }

  const probe = await adminClient.query(
    `SELECT to_regclass($1) IS NULL AS table_absent,
            to_regclass($2) IS NULL AS sequence_absent`,
    [MIGRATION_PROBE_TABLE, MIGRATION_PROBE_SEQUENCE],
  )

  if (!probe.rows[0]?.table_absent || !probe.rows[0]?.sequence_absent) {
    fail("A migration permission probe object was not removed.")
  }
}

function sanitizedFailure(error) {
  if (error instanceof SetupError) {
    return error.message
  }

  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "unknown"

  return `Database operation failed (PostgreSQL code ${code}).`
}

export async function runLocalSetup() {
  assertIgnored(".env.local")
  assertIgnored(".env.postgres.local")
  assertUntracked(".env.local")
  assertUntracked(".env.postgres.local")

  const adminSource = await readOptionalFile(ADMIN_ENV_PATH)
  if (adminSource === null) {
    fail("The local administrative credential file is missing.")
  }

  const adminPassword = parseUniqueEnvValue(
    adminSource,
    "PROJEKT_SPACE_POSTGRES_PASSWORD",
    { required: true },
  )
  if (adminPassword.length === 0) {
    fail("The local administrative password is empty.")
  }

  const appSource = await readOptionalFile(APP_ENV_PATH)

  // Parse and validate before connecting or mutating either persistent target.
  const databaseUrl = parseUniqueEnvValue(appSource ?? "", "DATABASE_URL")
  const shadowDatabaseUrl = parseUniqueEnvValue(
    appSource ?? "",
    "SHADOW_DATABASE_URL",
  )
  const migrationDatabaseUrl = parseUniqueEnvValue(
    appSource ?? "",
    "MIGRATION_DATABASE_URL",
  )
  let databasePassword
  if (databaseUrl !== null) {
    databasePassword = parseCompatibleDatabaseUrl(databaseUrl)
  }
  if (shadowDatabaseUrl !== null) {
    if (databasePassword === undefined) {
      fail("SHADOW_DATABASE_URL exists without DATABASE_URL.")
    }

    const shadowPassword = parseCompatibleShadowDatabaseUrl(shadowDatabaseUrl)
    if (shadowPassword !== databasePassword) {
      fail("DATABASE_URL and SHADOW_DATABASE_URL use different credentials.")
    }
  }
  if (migrationDatabaseUrl !== null) {
    if (databasePassword === undefined) {
      fail("MIGRATION_DATABASE_URL exists without DATABASE_URL.")
    }

    const migrationPassword = parseCompatibleMigrationDatabaseUrl(
      migrationDatabaseUrl,
    )
    if (migrationPassword === databasePassword) {
      fail("The migration and application roles must use different credentials.")
    }
  }

  await access(ROOT_DIRECTORY, fsConstants.W_OK).catch(() => {
    fail("The repository root is not writable.")
  })
  if (appSource !== null) {
    await access(APP_ENV_PATH, fsConstants.W_OK).catch(() => {
      fail("The local application credential file is not writable.")
    })
  }

  let adminClient

  try {
    adminClient = await connectClient(ADMIN_ROLE, adminPassword)
    await verifyIdentity(adminClient, ADMIN_ROLE)
    report("Administrative identity: verified.")

    const publicPrivileges = await inspectPublicPrivileges(adminClient)
    const existingRole = await getRole(adminClient)
    let finalPermissions

    const result = await reconcileRoleSetup({
      appSource,
      existingRole,
      authenticateExistingRole: verifyBasicApplicationAccess,
      verifyExistingRole: async (role) => {
        finalPermissions = await verifyRolePermissions(adminClient, role)
      },
      persistCredentials: async ({ expectedSource, nextSource }) => {
        await persistCredentialFile({
          filePath: APP_ENV_PATH,
          expectedSource,
          nextSource,
        })
      },
      createNewRole: async (password) => {
        createRoleWithNativeClient(password)
      },
      verifyNewRole: async (password) => {
        const role = await getRole(adminClient)
        if (!role) {
          fail("The new application role could not be verified.")
        }

        finalPermissions = await verifyRolePermissions(adminClient, role)
        await verifyBasicApplicationAccess(password)
      },
    })

    const savedSource = (await readOptionalFile(APP_ENV_PATH)) ?? ""
    const savedUrl = parseUniqueEnvValue(
      savedSource,
      "DATABASE_URL",
      { required: true },
    )
    const savedPassword = parseCompatibleDatabaseUrl(savedUrl)
    const finalRole = await getRole(adminClient)
    if (!finalRole) {
      fail("The application role could not be verified.")
    }

    const shadowDatabase = await ensureShadowDatabase(adminClient)
    const shadowCredential = await reconcileShadowCredential({
      appSource: savedSource,
      password: savedPassword,
      persistCredentials: async ({ expectedSource, nextSource }) => {
        await persistCredentialFile({
          filePath: APP_ENV_PATH,
          expectedSource,
          nextSource,
        })
      },
    })

    const finalAppSource = (await readOptionalFile(APP_ENV_PATH)) ?? ""
    const savedShadowUrl = parseUniqueEnvValue(
      finalAppSource,
      "SHADOW_DATABASE_URL",
      { required: true },
    )
    const savedShadowPassword = parseCompatibleShadowDatabaseUrl(savedShadowUrl)
    if (savedShadowPassword !== savedPassword) {
      fail("The saved database URLs use different credentials.")
    }

    const existingMigrationRole = await getRole(adminClient, MIGRATION_ROLE)
    let migrationPermissions
    const migrationResult = await reconcileMigrationRoleSetup({
      appSource: finalAppSource,
      applicationPassword: savedPassword,
      existingRole: existingMigrationRole,
      authenticateExistingRole: verifyBasicMigrationAccess,
      verifyExistingRole: async (role) => {
        migrationPermissions = await verifyMigrationRolePermissions(
          adminClient,
          role,
        )
      },
      persistCredentials: async ({ expectedSource, nextSource }) => {
        await persistCredentialFile({
          filePath: APP_ENV_PATH,
          expectedSource,
          nextSource,
        })
      },
      createNewRole: async (password) => {
        createMigrationRoleWithNativeClient(password)
      },
      verifyNewRole: async (password) => {
        const role = await getRole(adminClient, MIGRATION_ROLE)
        if (!role) {
          fail("The new migration role could not be verified.")
        }

        migrationPermissions = await verifyMigrationRolePermissions(
          adminClient,
          role,
        )
        await verifyBasicMigrationAccess(password)
      },
    })

    const completedAppSource = (await readOptionalFile(APP_ENV_PATH)) ?? ""
    const savedMigrationUrl = parseUniqueEnvValue(
      completedAppSource,
      "MIGRATION_DATABASE_URL",
      { required: true },
    )
    const savedMigrationPassword = parseCompatibleMigrationDatabaseUrl(
      savedMigrationUrl,
    )
    if (savedMigrationPassword === savedPassword) {
      fail("The saved migration and application credentials are not distinct.")
    }

    const finalMigrationRole = await getRole(adminClient, MIGRATION_ROLE)
    if (!finalMigrationRole) {
      fail("The migration role could not be verified.")
    }

    finalPermissions = await verifyRolePermissions(adminClient, finalRole)
    migrationPermissions = await verifyMigrationRolePermissions(
      adminClient,
      finalMigrationRole,
    )
    await verifyBasicApplicationAccess(savedPassword)
    await verifyBasicMigrationAccess(savedMigrationPassword)
    await verifyShadowDatabaseAccess(savedPassword)
    await verifyMigrationRoleRestrictedInShadow(adminPassword)
    await verifyIncorrectPasswordRejected()
    await verifyIncorrectPasswordRejected(MIGRATION_ROLE, "migration-role")
    await verifyTableCreationRejected(savedPassword, adminClient)
    await verifyMigrationObjectCreation(savedMigrationPassword, adminClient)
    await adminClient.query("SELECT 1")

    report(
      result.created
        ? "Application role: created in one native-client transaction."
        : "Application role: authenticated and reverified without mutation.",
    )
    report(
      result.credentialsWritten
        ? "Local application credentials: persisted before role creation."
        : "Local application credentials: reused without rotation.",
    )
    report(
      shadowDatabase.created
        ? "Shadow database: created with the application role as owner."
        : "Shadow database: existing owner verified without mutation.",
    )
    report(
      shadowCredential.credentialsWritten
        ? "Shadow database credential: added to the existing ignored local file."
        : "Shadow database credential: reused without change.",
    )
    report(
      migrationResult.created
        ? "Migration role: created with restricted attributes and grants."
        : "Migration role: authenticated and reverified without mutation.",
    )
    report(
      migrationResult.credentialsWritten
        ? "Migration credential: persisted before role creation."
        : "Migration credential: reused without rotation.",
    )
    report("Application authentication: correct password accepted; incorrect password rejected.")
    report("Migration authentication: correct password accepted; incorrect password rejected.")
    report("Application identity and SELECT 1: verified.")
    report("Migration identity and SELECT 1: verified.")
    report("Shadow database ownership, authentication, and reset access: verified.")
    report("Application role CREATEDB, superuser, role creation, replication, and bypass-RLS: absent.")
    report("Database CONNECT and public-schema USAGE: verified as direct grants.")
    report("Effective database and public-schema CREATE: absent.")
    report("Migration role administrative attributes and database CREATE: absent.")
    report("Migration role direct CONNECT and public-schema USAGE/CREATE: verified.")
    report("Migration role shadow-schema CREATE and ownership: absent.")
    report("Runtime table and sequence default privileges: verified.")
    report(
      `Effective TEMPORARY on the target database: ${
        finalPermissions.database_temporary ? "present" : "absent"
      }.`,
    )
    report(
      `PUBLIC database privileges: ${
        publicPrivileges.databasePrivileges.join(", ") || "none"
      }.`,
    )
    report(
      `PUBLIC public-schema privileges: ${
        publicPrivileges.schemaPrivileges.join(", ") || "none"
      }.`,
    )
    report("Regular table creation: rejected with insufficient_privilege; transaction rolled back.")
    report(
      `Migration role effective TEMPORARY on the target database: ${
        migrationPermissions.database_temporary ? "present" : "absent"
      }.`,
    )
    report("Migration create/default-grant probes: verified and rolled back.")
    report("Probe cleanup and final administrative connection: verified.")
  } finally {
    if (adminClient) {
      await closeClient(adminClient)
    }
  }
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === MODULE_PATH
}

if (isDirectExecution()) {
  try {
    await runLocalSetup()
  } catch (error) {
    process.stderr.write(`Setup failed: ${sanitizedFailure(error)}\n`)
    process.exitCode = 1
  }
}
