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

export default defineConfig({
  schema: SCHEMA_PATH,
  datasource: {
    // env() throws a variable-name-only error when DATABASE_URL is unset.
    url: env("DATABASE_URL"),
  },
})
