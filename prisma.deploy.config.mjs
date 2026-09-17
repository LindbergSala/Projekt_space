import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig, env } from "prisma/config"

import { assertDirectNeonMigrationDatabaseUrl } from "./scripts/prisma-url-policy.mjs"

const CONFIG_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const migrationDatabaseUrl = env("MIGRATION_DATABASE_URL")

assertDirectNeonMigrationDatabaseUrl(migrationDatabaseUrl)

export default defineConfig({
  schema: path.join(CONFIG_DIRECTORY, "prisma", "schema.prisma"),
  datasource: {
    url: migrationDatabaseUrl,
  },
})
