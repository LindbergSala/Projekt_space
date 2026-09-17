import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  buildVercelGenerationInvocation,
  runVercelPrismaGeneration,
} from "../scripts/prisma-generate-vercel.mjs"
import {
  buildProductionMigrationInvocation,
  runProductionMigration,
} from "../scripts/prisma-migrate-deploy.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const DIRECT_NEON_URL =
  "postgresql://migrator:synthetic-direct-password@ep-cool-darkness-123456.eu-central-1.aws.neon.tech/projekt_space?sslmode=require"
const POOLED_NEON_URL = DIRECT_NEON_URL.replace(
  "ep-cool-darkness-123456.",
  "ep-cool-darkness-123456-pooler.",
)

test("package scripts expose fixed generation and production migration wrappers", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(ROOT_DIRECTORY, "package.json"), "utf8"),
  )

  assert.equal(
    packageJson.scripts.postinstall,
    "node scripts/prisma-generate-vercel.mjs",
  )
  assert.equal(
    packageJson.scripts["prisma:migrate:deploy"],
    "node scripts/prisma-migrate-deploy.mjs",
  )
  assert.equal(
    packageJson.scripts["prisma:migrate:dev"],
    "node scripts/prisma-migrate-dev-docker.mjs",
  )
})

test("tooling image can run npm ci while keeping Vercel generation disabled", async () => {
  const [dockerfile, dockerignore, compose] = await Promise.all([
    readFile(
      path.join(ROOT_DIRECTORY, "docker/prisma-tooling.Dockerfile"),
      "utf8",
    ),
    readFile(path.join(ROOT_DIRECTORY, ".dockerignore"), "utf8"),
    readFile(path.join(ROOT_DIRECTORY, "compose.prisma.yaml"), "utf8"),
  ])
  const hookCopy =
    "COPY --chown=node:node scripts/prisma-generate-vercel.mjs ./scripts/"

  assert.ok(dockerfile.indexOf(hookCopy) >= 0)
  assert.ok(dockerfile.indexOf(hookCopy) < dockerfile.indexOf("RUN npm ci"))
  assert.match(dockerignore, /^!scripts\/prisma-generate-vercel\.mjs$/mu)
  assert.doesNotMatch(compose, /^\s+VERCEL:/mu)
})

test("generation hook skips Windows without starting Prisma", () => {
  let spawnCount = 0
  const messages = []
  const exitCode = runVercelPrismaGeneration([], {
    environment: { VERCEL: "1" },
    platform: "win32",
    spawnPrisma: () => {
      spawnCount += 1
      return { status: 0 }
    },
    report: (message) => messages.push(message),
  })

  assert.equal(exitCode, 0)
  assert.equal(spawnCount, 0)
  assert.deepEqual(messages, [
    "Prisma Client generation skipped outside a Vercel Linux build.",
  ])
})

test("generation hook runs only pinned Prisma generate on Vercel Linux", () => {
  let receivedEnvironment
  const exitCode = runVercelPrismaGeneration([], {
    environment: {
      VERCEL: "1",
      DATABASE_URL: "synthetic-runtime-url",
      MIGRATION_DATABASE_URL: "synthetic-migration-url",
      SHADOW_DATABASE_URL: "synthetic-shadow-url",
    },
    platform: "linux",
    spawnPrisma: (environment) => {
      receivedEnvironment = environment
      return { status: 23 }
    },
  })
  const invocation = buildVercelGenerationInvocation(receivedEnvironment)

  assert.equal(exitCode, 23)
  assert.equal(invocation.command, process.execPath)
  assert.match(
    invocation.args[0],
    /node_modules[\\/]prisma[\\/]build[\\/]index\.js$/u,
  )
  assert.deepEqual(invocation.args.slice(1), ["generate"])
  assert.equal(invocation.options.env.DATABASE_URL, "synthetic-runtime-url")
  assert.equal(
    Object.hasOwn(invocation.options.env, "MIGRATION_DATABASE_URL"),
    false,
  )
  assert.equal(
    Object.hasOwn(invocation.options.env, "SHADOW_DATABASE_URL"),
    false,
  )
})

test("generation hook rejects arguments and non-Vercel Linux remains a no-op", () => {
  let spawnCount = 0
  const errors = []
  const rejected = runVercelPrismaGeneration(["--schema", "other.prisma"], {
    environment: { VERCEL: "1" },
    platform: "linux",
    spawnPrisma: () => {
      spawnCount += 1
      return { status: 0 }
    },
    reportError: (message) => errors.push(message),
  })
  const skipped = runVercelPrismaGeneration([], {
    environment: {},
    platform: "linux",
    spawnPrisma: () => {
      spawnCount += 1
      return { status: 0 }
    },
    report: () => {},
  })

  assert.equal(rejected, 1)
  assert.equal(skipped, 0)
  assert.equal(spawnCount, 0)
  assert.deepEqual(errors, [
    "Prisma Client generation rejected unexpected arguments.",
  ])
})

test("production migration uses only fixed local Prisma migrate deploy", () => {
  const invocation = buildProductionMigrationInvocation(DIRECT_NEON_URL, {
    DATABASE_URL: "synthetic-pooled-url",
    MIGRATION_DATABASE_URL: DIRECT_NEON_URL,
    SHADOW_DATABASE_URL: "synthetic-shadow-url",
  })

  assert.equal(invocation.command, process.execPath)
  assert.match(
    invocation.args[0],
    /node_modules[\\/]prisma[\\/]build[\\/]index\.js$/u,
  )
  assert.deepEqual(invocation.args.slice(1, 3), ["migrate", "deploy"])
  assert.deepEqual(invocation.args.slice(3, 4), ["--config"])
  assert.match(invocation.args[4], /prisma\.deploy\.config\.mjs$/u)
  assert.equal(
    invocation.options.env.MIGRATION_DATABASE_URL,
    DIRECT_NEON_URL,
  )
  assert.equal(Object.hasOwn(invocation.options.env, "DATABASE_URL"), false)
  assert.equal(
    Object.hasOwn(invocation.options.env, "SHADOW_DATABASE_URL"),
    false,
  )
  assert.doesNotMatch(invocation.args.join(" "), /migrate dev|db push|reset|docker/u)
})

test("production migration rejects arguments before starting Prisma", () => {
  let spawnCount = 0
  const messages = []
  const exitCode = runProductionMigration(["--schema", "other.prisma"], {
    environment: { MIGRATION_DATABASE_URL: DIRECT_NEON_URL },
    spawnPrisma: () => {
      spawnCount += 1
      return { status: 0 }
    },
    reportError: (message) => messages.push(message),
  })

  assert.equal(exitCode, 1)
  assert.equal(spawnCount, 0)
  assert.deepEqual(messages, [
    "Production migration rejected unexpected arguments.",
  ])
})

test("production migration refuses the Windows host before starting Prisma", () => {
  let spawnCount = 0
  const messages = []
  const exitCode = runProductionMigration([], {
    environment: { MIGRATION_DATABASE_URL: DIRECT_NEON_URL },
    platform: "win32",
    spawnPrisma: () => {
      spawnCount += 1
      return { status: 0 }
    },
    reportError: (message) => messages.push(message),
  })

  assert.equal(exitCode, 1)
  assert.equal(spawnCount, 0)
  assert.deepEqual(messages, [
    "Production migration must run in an authorized Linux release environment.",
  ])
})

test("production migration requires one direct Neon URL without exposing credentials", () => {
  const secret = "never-print-this-deploy-secret"
  const cases = [
    {},
    {
      MIGRATION_DATABASE_URL: POOLED_NEON_URL.replace(
        "synthetic-direct-password",
        secret,
      ),
    },
    { MIGRATION_DATABASE_URL: `not-a-url-${secret}` },
  ]

  for (const environment of cases) {
    let spawnCount = 0
    const messages = []
    const exitCode = runProductionMigration([], {
      environment,
      platform: "linux",
      spawnPrisma: () => {
        spawnCount += 1
        return { status: 0 }
      },
      reportError: (message) => messages.push(message),
    })

    assert.equal(exitCode, 1)
    assert.equal(spawnCount, 0)
    assert.equal(messages.length, 1)
    assert.doesNotMatch(messages[0], new RegExp(secret))
  }
})

test("production migration preserves Prisma's exit status", () => {
  let receivedUrl
  const exitCode = runProductionMigration([], {
    environment: { MIGRATION_DATABASE_URL: DIRECT_NEON_URL },
    platform: "linux",
    spawnPrisma: (migrationDatabaseUrl) => {
      receivedUrl = migrationDatabaseUrl
      return { status: 17 }
    },
  })

  assert.equal(receivedUrl, DIRECT_NEON_URL)
  assert.equal(exitCode, 17)
})
