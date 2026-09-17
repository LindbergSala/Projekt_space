import path from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import { defineConfig, env } from "prisma/config"

import {
  assertCompatibleMigrationDatabaseUrl,
  assertDistinctDatabaseUrls,
} from "./scripts/prisma-url-policy.mjs"

const CONFIG_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ENV_LOCAL_PATH = path.join(CONFIG_DIRECTORY, ".env.local")
const SCHEMA_PATH = path.join(CONFIG_DIRECTORY, "prisma", "schema.prisma")

// Only the restricted application credential is loaded; administrative
// credentials in .env.postgres.local must never be read here.
dotenv.config({ path: ENV_LOCAL_PATH, quiet: true })

const databaseUrl = env("DATABASE_URL")
const configuredMigrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL
const migrationDatabaseUrl = configuredMigrationDatabaseUrl?.trim()
  ? configuredMigrationDatabaseUrl
  : undefined
const configuredShadowDatabaseUrl = process.env.SHADOW_DATABASE_URL
const shadowDatabaseUrl = configuredShadowDatabaseUrl?.trim()
  ? configuredShadowDatabaseUrl
  : undefined

if (migrationDatabaseUrl !== undefined) {
  assertCompatibleMigrationDatabaseUrl(databaseUrl, migrationDatabaseUrl)
}

if (shadowDatabaseUrl !== undefined) {
  assertDistinctDatabaseUrls(databaseUrl, shadowDatabaseUrl)

  if (migrationDatabaseUrl !== undefined) {
    assertDistinctDatabaseUrls(migrationDatabaseUrl, shadowDatabaseUrl)
  }
}

export default defineConfig({
  schema: SCHEMA_PATH,
  datasource: {
    // Prisma CLI uses the restricted migration identity when configured.
    url: migrationDatabaseUrl ?? databaseUrl,
    ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
  },
})
