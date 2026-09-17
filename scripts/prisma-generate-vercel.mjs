import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_PATH = fileURLToPath(import.meta.url)
const ROOT_DIRECTORY = path.resolve(path.dirname(MODULE_PATH), "..")
const PRISMA_CLI_PATH = path.join(
  ROOT_DIRECTORY,
  "node_modules",
  "prisma",
  "build",
  "index.js",
)

export function buildVercelGenerationInvocation(environment) {
  const childEnvironment = { ...environment }
  delete childEnvironment.MIGRATION_DATABASE_URL
  delete childEnvironment.SHADOW_DATABASE_URL

  return {
    args: [PRISMA_CLI_PATH, "generate"],
    command: process.execPath,
    options: {
      cwd: ROOT_DIRECTORY,
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true,
    },
  }
}

function defaultSpawnPrisma(environment) {
  const invocation = buildVercelGenerationInvocation(environment)
  return spawnSync(
    invocation.command,
    invocation.args,
    invocation.options,
  )
}

export function runVercelPrismaGeneration(args, {
  environment = process.env,
  platform = process.platform,
  spawnPrisma = defaultSpawnPrisma,
  report = (message) => process.stdout.write(`${message}\n`),
  reportError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  if (args.length !== 0) {
    reportError("Prisma Client generation rejected unexpected arguments.")
    return 1
  }

  if (platform !== "linux" || environment.VERCEL !== "1") {
    report("Prisma Client generation skipped outside a Vercel Linux build.")
    return 0
  }

  try {
    const result = spawnPrisma(environment)

    if (result.error) {
      reportError("Prisma Client generation failed to start.")
      return 1
    }

    return Number.isInteger(result.status) ? result.status : 1
  } catch {
    reportError("Prisma Client generation failed to start.")
    return 1
  }
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === MODULE_PATH
}

if (isDirectExecution()) {
  process.exitCode = runVercelPrismaGeneration(process.argv.slice(2))
}
