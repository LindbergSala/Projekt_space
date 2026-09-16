import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  hardenPrismaMigrationMetadata,
  sanitizedHardeningFailure,
} from "./harden-prisma-migration-metadata.mjs"

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const PRISMA_CLI_PATH = path.join(
  ROOT_DIRECTORY,
  "node_modules",
  "prisma",
  "build",
  "index.js",
)
const MIGRATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u

export class MigrationWorkflowError extends Error {}

function fail(message) {
  throw new MigrationWorkflowError(message)
}

export function validateMigrateDevArguments(args) {
  const validated = []
  let createOnlySeen = false
  let nameSeen = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === "--create-only") {
      if (createOnlySeen) {
        fail("The --create-only option may be specified only once.")
      }
      createOnlySeen = true
      validated.push(argument)
      continue
    }

    if (argument === "--name") {
      if (nameSeen) {
        fail("The --name option may be specified only once.")
      }
      const name = args[index + 1]
      if (typeof name !== "string" || !MIGRATION_NAME_PATTERN.test(name)) {
        fail("The migration name is missing or invalid.")
      }
      nameSeen = true
      validated.push(argument, name)
      index += 1
      continue
    }

    if (argument.startsWith("--name=")) {
      if (nameSeen) {
        fail("The --name option may be specified only once.")
      }
      const name = argument.slice("--name=".length)
      if (!MIGRATION_NAME_PATTERN.test(name)) {
        fail("The migration name is missing or invalid.")
      }
      nameSeen = true
      validated.push(argument)
      continue
    }

    fail("Unsupported Prisma migrate dev option.")
  }

  return validated
}

function defaultSpawnPrisma(args) {
  return spawnSync(
    process.execPath,
    [PRISMA_CLI_PATH, "migrate", "dev", ...args],
    {
      cwd: ROOT_DIRECTORY,
      stdio: "inherit",
      windowsHide: true,
    },
  )
}

export async function runMigrationWorkflow(args, {
  spawnPrisma = defaultSpawnPrisma,
  hardenMetadata = hardenPrismaMigrationMetadata,
  reportError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  let validatedArguments

  try {
    validatedArguments = validateMigrateDevArguments(args)
  } catch (error) {
    reportError(`Migration workflow rejected: ${error.message}`)
    return 1
  }

  let prismaExitCode = 1

  try {
    const prismaResult = spawnPrisma(validatedArguments)
    prismaExitCode = Number.isInteger(prismaResult.status)
      ? prismaResult.status
      : 1

    if (prismaResult.error) {
      reportError("Prisma migrate dev failed to start.")
    }
  } catch {
    reportError("Prisma migrate dev failed to start.")
  }
  let hardeningFailed = false

  try {
    await hardenMetadata()
  } catch (error) {
    hardeningFailed = true
    reportError(`Hardening failed: ${sanitizedHardeningFailure(error)}`)
  }

  if (prismaExitCode !== 0) {
    return prismaExitCode
  }

  return hardeningFailed ? 1 : 0
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === MODULE_PATH
}

if (isDirectExecution()) {
  process.exitCode = await runMigrationWorkflow(process.argv.slice(2))
}
