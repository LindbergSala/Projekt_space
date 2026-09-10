import { randomBytes } from "node:crypto"
import { access, readFile, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import pg from "pg"

const { Client } = pg

const ROOT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const ADMIN_ENV_PATH = path.join(ROOT_DIRECTORY, ".env.postgres.local")
const APP_ENV_PATH = path.join(ROOT_DIRECTORY, ".env.local")

const DATABASE_HOST = "127.0.0.1"
const DATABASE_PORT = 55432
const DATABASE_NAME = "projekt_space_dev"
const ADMIN_ROLE = "projekt_space_admin"
const APP_ROLE = "projekt_space_app"
const CONNECTION_TIMEOUT_MS = 5_000
const QUERY_TIMEOUT_MS = 5_000
const PROBE_TABLE = "public.projekt_space_role_permission_probe"

class SetupError extends Error {}

function report(message) {
  process.stdout.write(`${message}\n`)
}

function fail(message) {
  throw new SetupError(message)
}

function sanitizedDatabaseError(error) {
  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "unknown"

  return `Database operation failed (PostgreSQL code ${code}).`
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

function readSingleEnvValue(source, name) {
  const normalized = source.replaceAll("\r\n", "\n")
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(
    `^(?:export[ \\t]+)?${escapedName}[ \\t]*=.*$`,
    "gm",
  )
  const matches = normalized.match(pattern) ?? []

  if (matches.length !== 1) {
    return { count: matches.length, value: null }
  }

  const parsed = dotenv.parse(matches[0])
  return { count: 1, value: parsed[name] ?? null }
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

function createDatabaseUrl(password) {
  return (
    `postgresql://${encodeURIComponent(APP_ROLE)}:` +
    `${encodeURIComponent(password)}@${DATABASE_HOST}:${DATABASE_PORT}/` +
    encodeURIComponent(DATABASE_NAME)
  )
}

function parseCompatibleDatabaseUrl(value) {
  let url

  try {
    url = new URL(value)
  } catch {
    fail("Configuration conflict: DATABASE_URL is not a valid URL.")
  }

  let username
  let password
  let database

  try {
    username = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    fail("Configuration conflict: DATABASE_URL has invalid URL encoding.")
  }

  const compatible =
    url.protocol === "postgresql:" &&
    url.hostname === DATABASE_HOST &&
    url.port === String(DATABASE_PORT) &&
    database === DATABASE_NAME &&
    username === APP_ROLE &&
    password.length > 0

  if (!compatible) {
    fail("Configuration conflict: DATABASE_URL targets unexpected settings.")
  }

  return password
}

function appendDatabaseUrl(source, databaseUrl) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n"
  const prefix = source.length === 0 || source.endsWith("\n")
    ? source
    : `${source}${newline}`

  return `${prefix}DATABASE_URL=${databaseUrl}${newline}`
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

async function assertCompatibleExistingRole(adminClient, role) {
  const restricted =
    role.rolcanlogin === true &&
    role.rolsuper === false &&
    role.rolcreatedb === false &&
    role.rolcreaterole === false &&
    role.rolreplication === false &&
    role.rolbypassrls === false

  if (!restricted) {
    fail("Role conflict: the existing application role has unexpected attributes.")
  }

  const memberships = await adminClient.query(
    `SELECT granted_role.rolname
       FROM pg_catalog.pg_auth_members AS membership
       JOIN pg_catalog.pg_roles AS member_role
         ON member_role.oid = membership.member
       JOIN pg_catalog.pg_roles AS granted_role
         ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = $1`,
    [APP_ROLE],
  )

  if (memberships.rowCount !== 0) {
    fail("Role conflict: the application role belongs to another role.")
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
    fail("Role conflict: the application role owns a database or schema.")
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
    fail("Role conflict: the application role has default privileges.")
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
    fail("Permission conflict: application-visible table privileges already exist.")
  }
}

async function createOrGrantRole(adminClient, existingRole, password) {
  await adminClient.query("BEGIN")

  try {
    if (!existingRole) {
      await adminClient.query(
        "SELECT set_config('projekt_space.setup_password', $1, true)",
        [password],
      )
      await adminClient.query(`
        DO $setup$
        BEGIN
          EXECUTE 'CREATE ROLE projekt_space_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
          EXECUTE format(
            'ALTER ROLE projekt_space_app PASSWORD %L',
            current_setting('projekt_space.setup_password')
          );
        END
        $setup$
      `)
    }

    await adminClient.query(
      "GRANT CONNECT ON DATABASE projekt_space_dev TO projekt_space_app",
    )
    await adminClient.query(
      "GRANT USAGE ON SCHEMA public TO projekt_space_app",
    )
    await adminClient.query("COMMIT")
  } catch (error) {
    await adminClient.query("ROLLBACK").catch(() => {})
    throw error
  }
}

async function verifyRolePermissions(adminClient, role) {
  await assertCompatibleExistingRole(adminClient, role)

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
    fail("Permission verification failed: required access is missing.")
  }

  if (permissions.database_create || permissions.schema_create) {
    fail("Permission verification failed: effective CREATE access exists.")
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
    fail("Permission verification failed: required direct grants are missing.")
  }

  return permissions
}

async function verifyIncorrectPasswordRejected() {
  const incorrectPassword = randomBytes(32).toString("base64url")

  try {
    const client = await connectClient(APP_ROLE, incorrectPassword)
    await closeClient(client)
    fail("Authentication verification failed: an incorrect password succeeded.")
  } catch (error) {
    if (error instanceof SetupError) {
      throw error
    }

    if (!error || typeof error !== "object" || error.code !== "28P01") {
      fail("Incorrect-password verification returned an unexpected failure.")
    }
  }
}

async function verifyApplicationAccess(password, adminClient) {
  const appClient = await connectClient(APP_ROLE, password)
  let transactionOpen = false

  try {
    await verifyIdentity(appClient, APP_ROLE)
    const selectResult = await appClient.query("SELECT 1 AS probe")

    if (selectResult.rows[0]?.probe !== 1) {
      fail("Application SELECT verification failed.")
    }

    await appClient.query("BEGIN")
    transactionOpen = true

    try {
      await appClient.query(
        `CREATE TABLE ${PROBE_TABLE} (probe integer NOT NULL)`,
      )
      fail("Permission verification failed: regular table creation succeeded.")
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

  await verifyIncorrectPasswordRejected()

  const probe = await adminClient.query(
    "SELECT to_regclass($1) IS NULL AS absent",
    [PROBE_TABLE],
  )

  if (!probe.rows[0]?.absent) {
    fail("Probe cleanup verification failed.")
  }
}

async function main() {
  assertIgnored(".env.local")

  const adminSource = await readOptionalFile(ADMIN_ENV_PATH)
  if (adminSource === null) {
    fail("The local administrative credential file is missing.")
  }

  const adminCredentials = dotenv.parse(adminSource)
  const adminPassword = adminCredentials.PROJEKT_SPACE_POSTGRES_PASSWORD
  if (typeof adminPassword !== "string" || adminPassword.length === 0) {
    fail("The local administrative password is missing.")
  }

  const appSource = (await readOptionalFile(APP_ENV_PATH)) ?? ""
  const appAssignment = readSingleEnvValue(appSource, "DATABASE_URL")
  if (appAssignment.count > 1) {
    fail("Configuration conflict: multiple DATABASE_URL entries exist.")
  }

  let appPassword = null
  if (appAssignment.count === 1) {
    if (typeof appAssignment.value !== "string") {
      fail("Configuration conflict: DATABASE_URL could not be parsed.")
    }
    appPassword = parseCompatibleDatabaseUrl(appAssignment.value)
  }

  await access(ROOT_DIRECTORY, fsConstants.W_OK).catch(() => {
    fail("The repository root is not writable.")
  })
  if (appSource.length > 0) {
    await access(APP_ENV_PATH, fsConstants.W_OK).catch(() => {
      fail("The local application credential file is not writable.")
    })
  }

  let adminClient
  let roleCreated = false
  let credentialsWritten = false

  try {
    adminClient = await connectClient(ADMIN_ROLE, adminPassword)
    await verifyIdentity(adminClient, ADMIN_ROLE)
    report("Administrative identity: verified.")

    const publicPrivileges = await inspectPublicPrivileges(adminClient)
    const existingRole = await getRole(adminClient)

    if (existingRole && !appPassword) {
      fail("Role conflict: the application role exists without compatible local credentials.")
    }

    if (existingRole) {
      await assertCompatibleExistingRole(adminClient, existingRole)
      report("Application role: compatible existing role found; password unchanged.")
    } else {
      appPassword ??= randomBytes(32).toString("base64url")
    }

    await createOrGrantRole(adminClient, existingRole, appPassword)
    roleCreated = !existingRole

    if (appAssignment.count === 0) {
      const databaseUrl = createDatabaseUrl(appPassword)
      await writeFile(APP_ENV_PATH, appendDatabaseUrl(appSource, databaseUrl), "utf8")
      credentialsWritten = true
    }

    const role = await getRole(adminClient)
    if (!role) {
      fail("Application role verification failed: role is missing.")
    }

    const permissions = await verifyRolePermissions(adminClient, role)
    await verifyApplicationAccess(appPassword, adminClient)
    await adminClient.query("SELECT 1")

    report(
      roleCreated
        ? "Application role: created with restricted attributes."
        : "Application role: restricted attributes reverified.",
    )
    report(
      credentialsWritten
        ? "Local application credentials: written to ignored .env.local."
        : "Local application credentials: compatible values reused without rotation.",
    )
    report("Application authentication: correct password accepted; incorrect password rejected.")
    report("Application identity and SELECT 1: verified.")
    report("Database CONNECT and public-schema USAGE: verified as direct grants.")
    report("Effective database and public-schema CREATE: absent.")
    report(
      `Effective TEMPORARY on the target database: ${
        permissions.database_temporary ? "present" : "absent"
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
  } catch (error) {
    if (roleCreated && !credentialsWritten) {
      process.stderr.write(
        "Setup partially completed: the role may exist, but local credentials were not written.\n",
      )
    }

    if (error instanceof SetupError) {
      process.stderr.write(`Setup failed: ${error.message}\n`)
    } else {
      process.stderr.write(`Setup failed: ${sanitizedDatabaseError(error)}\n`)
    }
    process.exitCode = 1
  } finally {
    if (adminClient) {
      await closeClient(adminClient)
    }
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof SetupError) {
    process.stderr.write(`Setup failed: ${error.message}\n`)
  } else {
    process.stderr.write("Setup failed: an unexpected local setup error occurred.\n")
  }
  process.exitCode = 1
}
