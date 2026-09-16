import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  SetupError,
  parseCompatibleDatabaseUrl,
  parseCompatibleMigrationDatabaseUrl,
  parseCompatibleShadowDatabaseUrl,
  parseUniqueEnvValue,
} from "./setup-local-db-role.mjs"
import {
  MigrationWorkflowError,
  validateMigrateDevArguments,
} from "./prisma-migrate-dev.mjs"

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const ENV_LOCAL_PATH = path.join(ROOT_DIRECTORY, ".env.local")
const COMPOSE_FILE = "compose.prisma.yaml"
const COMPOSE_PROJECT = "projekt-space-prisma-tooling"
const TOOLING_SERVICE = "prisma-tooling"
const INTERNAL_DATABASE_HOST = "postgres"
const INTERNAL_DATABASE_PORT = "5432"

export class ToolingLauncherError extends Error {}

function fail(message) {
  throw new ToolingLauncherError(message)
}

export function translateLocalDatabaseUrl(value, validateUrl) {
  validateUrl(value)

  const translated = new URL(value)
  translated.hostname = INTERNAL_DATABASE_HOST
  translated.port = INTERNAL_DATABASE_PORT
  return translated.toString()
}

export async function loadToolingEnvironment({
  readEnvironmentFile = () => readFile(ENV_LOCAL_PATH, "utf8"),
} = {}) {
  let source

  try {
    source = await readEnvironmentFile()
  } catch {
    fail("The local migration credential file could not be read.")
  }

  const databaseUrl = parseUniqueEnvValue(source, "DATABASE_URL", {
    required: true,
  })
  const migrationDatabaseUrl = parseUniqueEnvValue(
    source,
    "MIGRATION_DATABASE_URL",
    { required: true },
  )
  const shadowDatabaseUrl = parseUniqueEnvValue(source, "SHADOW_DATABASE_URL", {
    required: true,
  })

  const applicationPassword = parseCompatibleDatabaseUrl(databaseUrl)
  const migrationPassword = parseCompatibleMigrationDatabaseUrl(
    migrationDatabaseUrl,
  )
  const shadowPassword = parseCompatibleShadowDatabaseUrl(shadowDatabaseUrl)

  if (applicationPassword !== shadowPassword) {
    fail("DATABASE_URL and SHADOW_DATABASE_URL use different credentials.")
  }
  if (applicationPassword === migrationPassword) {
    fail("The migration and application roles must use different credentials.")
  }

  return {
    DATABASE_URL: translateLocalDatabaseUrl(
      databaseUrl,
      parseCompatibleDatabaseUrl,
    ),
    MIGRATION_DATABASE_URL: translateLocalDatabaseUrl(
      migrationDatabaseUrl,
      parseCompatibleMigrationDatabaseUrl,
    ),
    SHADOW_DATABASE_URL: translateLocalDatabaseUrl(
      shadowDatabaseUrl,
      parseCompatibleShadowDatabaseUrl,
    ),
  }
}

export function buildComposeArguments(migrationArguments) {
  return [
    "compose",
    "--file",
    COMPOSE_FILE,
    "--project-name",
    COMPOSE_PROJECT,
    "run",
    "--rm",
    "--no-deps",
    TOOLING_SERVICE,
    ...migrationArguments,
  ]
}

function defaultSpawnCompose(composeArguments, toolingEnvironment) {
  return spawnSync("docker", composeArguments, {
    cwd: ROOT_DIRECTORY,
    env: {
      ...process.env,
      ...toolingEnvironment,
    },
    stdio: "inherit",
    windowsHide: true,
  })
}

function sanitizedLauncherFailure(error) {
  if (
    error instanceof ToolingLauncherError ||
    error instanceof MigrationWorkflowError ||
    error instanceof SetupError
  ) {
    return error.message
  }

  return "The Prisma tooling container could not be prepared."
}

export async function runContainerMigration(args, {
  loadEnvironment = loadToolingEnvironment,
  spawnCompose = defaultSpawnCompose,
  reportError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  let validatedArguments

  try {
    validatedArguments = validateMigrateDevArguments(args)
  } catch (error) {
    reportError(`Migration workflow rejected: ${sanitizedLauncherFailure(error)}`)
    return 1
  }

  let toolingEnvironment
  try {
    toolingEnvironment = await loadEnvironment()
  } catch (error) {
    reportError(`Migration workflow rejected: ${sanitizedLauncherFailure(error)}`)
    return 1
  }

  try {
    const result = spawnCompose(
      buildComposeArguments(validatedArguments),
      toolingEnvironment,
    )

    if (result.error) {
      reportError("The Prisma tooling container failed to start.")
      return 1
    }

    return Number.isInteger(result.status) ? result.status : 1
  } catch {
    reportError("The Prisma tooling container failed to start.")
    return 1
  }
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === MODULE_PATH
}

if (isDirectExecution()) {
  process.exitCode = await runContainerMigration(process.argv.slice(2))
}
