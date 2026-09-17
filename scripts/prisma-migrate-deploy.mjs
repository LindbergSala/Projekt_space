import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assertDirectNeonMigrationDatabaseUrl } from "./prisma-url-policy.mjs"

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const PRISMA_CLI_PATH = path.join(
  ROOT_DIRECTORY,
  "node_modules",
  "prisma",
  "build",
  "index.js",
)
const DEPLOY_CONFIG_PATH = path.join(
  ROOT_DIRECTORY,
  "prisma.deploy.config.mjs",
)

export function buildProductionMigrationInvocation(
  migrationDatabaseUrl,
  environment,
) {
  const childEnvironment = {
    ...environment,
    MIGRATION_DATABASE_URL: migrationDatabaseUrl,
  }
  delete childEnvironment.DATABASE_URL
  delete childEnvironment.SHADOW_DATABASE_URL

  return {
    args: [
      PRISMA_CLI_PATH,
      "migrate",
      "deploy",
      "--config",
      DEPLOY_CONFIG_PATH,
    ],
    command: process.execPath,
    options: {
      cwd: ROOT_DIRECTORY,
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true,
    },
  }
}

function defaultSpawnPrisma(migrationDatabaseUrl, environment) {
  const invocation = buildProductionMigrationInvocation(
    migrationDatabaseUrl,
    environment,
  )
  return spawnSync(
    invocation.command,
    invocation.args,
    invocation.options,
  )
}

export function runProductionMigration(args, {
  environment = process.env,
  platform = process.platform,
  spawnPrisma = defaultSpawnPrisma,
  reportError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  if (args.length !== 0) {
    reportError("Production migration rejected unexpected arguments.")
    return 1
  }

  if (platform !== "linux") {
    reportError("Production migration must run in an authorized Linux release environment.")
    return 1
  }

  const migrationDatabaseUrl = environment.MIGRATION_DATABASE_URL
  if (
    typeof migrationDatabaseUrl !== "string" ||
    migrationDatabaseUrl.length === 0 ||
    migrationDatabaseUrl.trim() !== migrationDatabaseUrl
  ) {
    reportError("Production migration requires MIGRATION_DATABASE_URL.")
    return 1
  }

  try {
    assertDirectNeonMigrationDatabaseUrl(migrationDatabaseUrl)
  } catch {
    reportError("Production migration requires a valid direct Neon URL.")
    return 1
  }

  try {
    const result = spawnPrisma(migrationDatabaseUrl, environment)

    if (result.error) {
      reportError("Prisma migrate deploy failed to start.")
      return 1
    }

    return Number.isInteger(result.status) ? result.status : 1
  } catch {
    reportError("Prisma migrate deploy failed to start.")
    return 1
  }
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === MODULE_PATH
}

if (isDirectExecution()) {
  process.exitCode = runProductionMigration(process.argv.slice(2))
}
