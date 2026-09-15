import path from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import { defineConfig, env } from "prisma/config"

const CONFIG_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ENV_LOCAL_PATH = path.join(CONFIG_DIRECTORY, ".env.local")
const SCHEMA_PATH = path.join(CONFIG_DIRECTORY, "prisma", "schema.prisma")

// Only the restricted application credential is loaded; administrative
// credentials in .env.postgres.local must never be read here.
dotenv.config({ path: ENV_LOCAL_PATH, quiet: true })

function logicalPostgresDatabase(value, variableName) {
  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`)
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${variableName} must be a PostgreSQL URL.`)
  }

  let database
  try {
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    throw new Error(`${variableName} contains invalid URL encoding.`)
  }

  if (url.hostname.length === 0 || database.length === 0) {
    throw new Error(`${variableName} must identify a PostgreSQL database.`)
  }

  return {
    database,
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
  }
}

export function assertDistinctDatabaseUrls(databaseUrl, shadowDatabaseUrl) {
  const database = logicalPostgresDatabase(databaseUrl, "DATABASE_URL")
  const shadowDatabase = logicalPostgresDatabase(
    shadowDatabaseUrl,
    "SHADOW_DATABASE_URL",
  )

  if (
    database.host === shadowDatabase.host &&
    database.port === shadowDatabase.port &&
    database.database === shadowDatabase.database
  ) {
    throw new Error(
      "DATABASE_URL and SHADOW_DATABASE_URL must identify different databases.",
    )
  }
}

const databaseUrl = env("DATABASE_URL")
const configuredShadowDatabaseUrl = process.env.SHADOW_DATABASE_URL
const shadowDatabaseUrl = configuredShadowDatabaseUrl?.trim()
  ? configuredShadowDatabaseUrl
  : undefined

if (shadowDatabaseUrl !== undefined) {
  assertDistinctDatabaseUrls(databaseUrl, shadowDatabaseUrl)
}

export default defineConfig({
  schema: SCHEMA_PATH,
  datasource: {
    // env() throws a variable-name-only error when DATABASE_URL is unset.
    url: databaseUrl,
    ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
  },
})
