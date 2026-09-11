import { randomBytes } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import {
  access,
  readFile,
  rename,
  unlink,
  writeFile,
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
const ADMIN_ROLE = "projekt_space_admin"
const APP_ROLE = "projekt_space_app"
const EXAMPLE_PASSWORD = "replace-with-generated-password"
const CONNECTION_TIMEOUT_MS = 5_000
const QUERY_TIMEOUT_MS = 5_000
const PROBE_TABLE = "public.projekt_space_role_permission_probe"

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

export function parseCompatibleDatabaseUrl(value) {
  let url

  try {
    url = new URL(value)
  } catch {
    fail("DATABASE_URL is not a valid URL.")
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    fail("DATABASE_URL query parameters and fragments are not supported.")
  }

  let username
  let password
  let database

  try {
    username = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    fail("DATABASE_URL contains invalid URL encoding.")
  }

  const compatible =
    url.protocol === "postgresql:" &&
    url.hostname === DATABASE_HOST &&
    url.port === String(DATABASE_PORT) &&
    database === DATABASE_NAME &&
    username === APP_ROLE &&
    password.length > 0

  if (!compatible) {
    fail("DATABASE_URL targets unexpected local database settings.")
  }

  if (password === EXAMPLE_PASSWORD) {
    fail("DATABASE_URL still contains the example password.")
  }

  return password
}

export function createDatabaseUrl(password) {
  return (
    `postgresql://${encodeURIComponent(APP_ROLE)}:` +
    `${encodeURIComponent(password)}@${DATABASE_HOST}:${DATABASE_PORT}/` +
    encodeURIComponent(DATABASE_NAME)
  )
}

export function appendDatabaseUrl(source, databaseUrl) {
  const content = source ?? ""
  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const prefix = content.length === 0 || content.endsWith("\n")
    ? content
    : `${content}${newline}`

  return `${prefix}DATABASE_URL=${databaseUrl}${newline}`
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

export async function persistCredentialFile({
  filePath,
  expectedSource,
  nextSource,
}) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  )
  let temporaryFileExists = false

  try {
    const currentSource = await readOptionalFile(filePath)
    if (currentSource !== expectedSource) {
      fail("The local credential file changed before it could be updated.")
    }

    await writeFile(temporaryPath, nextSource, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    temporaryFileExists = true

    const sourceBeforeRename = await readOptionalFile(filePath)
    if (sourceBeforeRename !== expectedSource) {
      fail("The local credential file changed while it was being updated.")
    }

    await rename(temporaryPath, filePath)
    temporaryFileExists = false

    const persistedSource = await readOptionalFile(filePath)
    if (persistedSource !== nextSource) {
      fail("The saved local credential file could not be verified.")
    }
  } catch (error) {
    if (error instanceof SetupError) {
      throw error
    }

    fail("The local application credential could not be persisted safely.")
  } finally {
    if (temporaryFileExists) {
      await unlink(temporaryPath).catch(() => {})
    }
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

function clientOptions(user, password) {
  return {
    host: DATABASE_HOST,
    port: DATABASE_PORT,
    database: DATABASE_NAME,
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

async function connectClient(user, password) {
  const client = new Client(clientOptions(user, password))

  try {
    await client.connect()
    return client
  } catch (error) {
    await closeClient(client)
    throw error
  }
}

async function verifyIdentity(client, expectedUser) {
  const result = await client.query(
    "SELECT current_user AS user_name, current_database() AS database_name",
  )
  const identity = result.rows[0]

  if (
    identity?.user_name !== expectedUser ||
    identity?.database_name !== DATABASE_NAME
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

async function getRole(adminClient) {
  const result = await adminClient.query(
    `SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
       FROM pg_catalog.pg_roles
      WHERE rolname = $1`,
    [APP_ROLE],
  )

  return result.rows[0] ?? null
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

async function assertCompatibleRole(adminClient, role) {
  const restricted =
    role.rolcanlogin === true &&
    role.rolsuper === false &&
    role.rolcreatedb === false &&
    role.rolcreaterole === false &&
    role.rolreplication === false &&
    role.rolbypassrls === false

  if (!restricted) {
    fail("The existing application role has unexpected attributes.")
  }

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

  const ownership = await adminClient.query(
    `SELECT
       EXISTS(
         SELECT 1 FROM pg_catalog.pg_database WHERE datdba = $1
       ) AS owns_database,
       EXISTS(
         SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = $1
       ) AS owns_schema`,
    [role.oid],
  )

  if (ownership.rows[0]?.owns_database || ownership.rows[0]?.owns_schema) {
    fail("The application role owns a database or schema.")
  }

  const defaultPrivileges = await adminClient.query(
    `SELECT 1
       FROM pg_catalog.pg_default_acl AS defaults,
            LATERAL aclexplode(defaults.defaclacl) AS privileges
      WHERE privileges.grantee = $1
      LIMIT 1`,
    [role.oid],
  )

  if (defaultPrivileges.rowCount !== 0) {
    fail("The application role has unexpected default privileges.")
  }

  const tablePrivileges = await adminClient.query(
    `SELECT 1
       FROM information_schema.table_privileges
      WHERE grantee IN ($1, 'PUBLIC')
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      LIMIT 1`,
    [APP_ROLE],
  )

  if (tablePrivileges.rowCount !== 0) {
    fail("Unexpected application-visible table privileges exist.")
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

async function verifyIncorrectPasswordRejected() {
  const incorrectPassword = randomBytes(32).toString("base64url")

  try {
    const client = await connectClient(APP_ROLE, incorrectPassword)
    await closeClient(client)
    fail("An incorrect application password unexpectedly succeeded.")
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
  if (databaseUrl !== null) {
    parseCompatibleDatabaseUrl(databaseUrl)
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

    const savedUrl = parseUniqueEnvValue(
      (await readOptionalFile(APP_ENV_PATH)) ?? "",
      "DATABASE_URL",
      { required: true },
    )
    const savedPassword = parseCompatibleDatabaseUrl(savedUrl)

    await verifyBasicApplicationAccess(savedPassword)
    await verifyIncorrectPasswordRejected()
    await verifyTableCreationRejected(savedPassword, adminClient)
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
    report("Application authentication: correct password accepted; incorrect password rejected.")
    report("Application identity and SELECT 1: verified.")
    report("Database CONNECT and public-schema USAGE: verified as direct grants.")
    report("Effective database and public-schema CREATE: absent.")
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
