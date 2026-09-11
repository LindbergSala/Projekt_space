import path from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { SetupError, parseCompatibleDatabaseUrl } from "./setup-local-db-role.mjs"

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const ENV_LOCAL_PATH = path.join(ROOT_DIRECTORY, ".env.local")

const EXPECTED_APP_ROLE = "projekt_space_app"
const EXPECTED_DATABASE_NAME = "projekt_space_dev"
const CONNECTION_TIMEOUT_MS = 5_000
const QUERY_TIMEOUT_MS = 5_000

// Reuses the reviewed role-setup validation, so both scripts agree on what a
// compatible local application DATABASE_URL looks like.
class VerificationError extends SetupError {}

function fail(message) {
  throw new VerificationError(message)
}

function report(message) {
  process.stdout.write(`${message}\n`)
}

function sanitizedFailure(error) {
  if (error instanceof SetupError) {
    return error.message
  }

  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "unknown"

  return `Database operation failed (code ${code}).`
}

function loadDatabaseUrl() {
  // Only the restricted application credential is loaded; administrative
  // credentials in .env.postgres.local must never be read here.
  dotenv.config({ path: ENV_LOCAL_PATH, quiet: true })

  const databaseUrl = process.env.DATABASE_URL

  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    fail("DATABASE_URL is missing.")
  }

  // Rejects unexpected hosts/ports/database/user, query parameters or
  // fragments, and the documented example password.
  parseCompatibleDatabaseUrl(databaseUrl)

  return databaseUrl
}

async function verifyConnection(databaseUrl) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    ssl: false,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  })
  const prisma = new PrismaClient({ adapter })

  try {
    const rows = await prisma.$queryRaw`
      SELECT
        1 AS probe,
        current_user AS user_name,
        current_database() AS database_name
    `
    const identity = rows[0]

    const verified =
      Number(identity?.probe) === 1 &&
      identity?.user_name === EXPECTED_APP_ROLE &&
      identity?.database_name === EXPECTED_DATABASE_NAME

    if (!verified) {
      fail("The query result did not match the expected application identity.")
    }

    report(
      `Connected through Prisma as "${EXPECTED_APP_ROLE}" to ` +
        `"${EXPECTED_DATABASE_NAME}"; SELECT 1 succeeded.`,
    )
  } finally {
    // The adapter owns its internally created pool because it was built from
    // a config object rather than an external pg.Pool; $disconnect() ends it.
    await prisma.$disconnect()
  }
}

try {
  const databaseUrl = loadDatabaseUrl()
  await verifyConnection(databaseUrl)
} catch (error) {
  process.stderr.write(`Verification failed: ${sanitizedFailure(error)}\n`)
  process.exitCode = 1
}
