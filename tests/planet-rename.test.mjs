import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  normalizePlanetName,
  PLANET_NAME_VALIDATION_ERROR,
  PLANET_RENAME_ERROR,
  renamePlanetForOwner,
} from "../lib/planet-name-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const ROLLBACK_SENTINEL = new Error("rollback planet-rename test data")

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

test("Planet schema and migration add only the required bounded name", async () => {
  const schema = await source("prisma/schema.prisma")
  const migrationDirectories = await readdir(
    path.join(ROOT_DIRECTORY, "prisma/migrations"),
    { withFileTypes: true },
  )
  const nameMigration = migrationDirectories.find(
    (entry) => entry.isDirectory() && entry.name.endsWith("_add_planet_name"),
  )

  assert.match(
    schema,
    /name\s+String\s+@default\("Unnamed Planet"\)\s+@db\.VarChar\(40\)/u,
  )
  assert.ok(nameMigration, "expected the generated add_planet_name migration")

  const migration = await source(
    `prisma/migrations/${nameMigration.name}/migration.sql`,
  )
  assert.equal(
    migration.replaceAll("\r\n", "\n").trim(),
    [
      "-- AlterTable",
      'ALTER TABLE "planet" ADD COLUMN     "name" VARCHAR(40) NOT NULL DEFAULT \'Unnamed Planet\';',
    ].join("\n"),
  )
  assert.doesNotMatch(
    migration,
    /DROP|DELETE|TRUNCATE|CREATE TABLE|ALTER COLUMN|RENAME|ownerId|FOREIGN KEY/iu,
  )
})

test("planet names are trimmed and measured by Unicode code points", () => {
  assert.equal(normalizePlanetName("  Alpha Prime  "), "Alpha Prime")
  assert.equal(normalizePlanetName("A B"), "A B")
  assert.equal(normalizePlanetName("🚀🚀🚀"), "🚀🚀🚀")
  assert.equal(normalizePlanetName("a".repeat(40)), "a".repeat(40))
  assert.equal(normalizePlanetName("🚀".repeat(40)), "🚀".repeat(40))
})

test("invalid planet names fail with one fixed validation error", () => {
  const invalidNames = [
    undefined,
    null,
    42,
    "",
    "   ",
    "ab",
    "a".repeat(41),
    "🚀".repeat(41),
    "Alpha\nPrime",
    "Alpha\u0000Prime",
  ]

  for (const name of invalidNames) {
    assert.throws(() => normalizePlanetName(name), {
      message: PLANET_NAME_VALIDATION_ERROR,
    })
  }
})

test("invalid IDs and names are rejected before a mutation", async () => {
  let mutationCount = 0
  const planetModel = {
    async updateMany() {
      mutationCount += 1
      return { count: 1 }
    },
  }

  await assert.rejects(
    renamePlanetForOwner({
      ownerId: "authenticated-owner",
      planetId: " padded ",
      planetName: "Valid name",
      planetModel,
    }),
    { message: PLANET_RENAME_ERROR },
  )
  await assert.rejects(
    renamePlanetForOwner({
      ownerId: "authenticated-owner",
      planetId: "planet-owned",
      planetName: "no",
      planetModel,
    }),
    { message: PLANET_NAME_VALIDATION_ERROR },
  )
  assert.equal(mutationCount, 0)
})

test("rename mutation combines the exact ID and server owner", async () => {
  let query
  const renamed = await renamePlanetForOwner({
    ownerId: "authenticated-owner",
    planetId: "planet-owned",
    planetName: "  New Horizon  ",
    planetModel: {
      async updateMany(receivedQuery) {
        query = receivedQuery
        return { count: 1 }
      },
    },
  })

  assert.deepEqual(query, {
    where: {
      id: "planet-owned",
      ownerId: "authenticated-owner",
    },
    data: {
      name: "New Horizon",
    },
  })
  assert.deepEqual(renamed, { id: "planet-owned" })
})

test("missing, foreign, ambiguous, and database failures use one generic error", async () => {
  for (const count of [0, 2]) {
    await assert.rejects(
      renamePlanetForOwner({
        ownerId: "authenticated-owner",
        planetId: "planet-not-owned",
        planetName: "Valid name",
        planetModel: { updateMany: async () => ({ count }) },
      }),
      { message: PLANET_RENAME_ERROR },
    )
  }

  await assert.rejects(
    renamePlanetForOwner({
      ownerId: "authenticated-owner",
      planetId: "planet-owned",
      planetName: "Valid name",
      planetModel: {
        async updateMany() {
          throw new Error("raw database detail")
        },
      },
    }),
    (error) =>
      error.message === PLANET_RENAME_ERROR &&
      !error.message.includes("raw database detail"),
  )
})

test("authenticated rename derives owner identity and accepts only selectors and name", async () => {
  const operation = await source("lib/owned-planets.js")

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    operation,
    /export async function renameAuthenticatedUserPlanet\(planetId, planetName\)/u,
  )
  assert.match(operation, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.match(
    operation,
    /renamePlanetForOwner\(\{\s*ownerId,\s*planetId,\s*planetName,\s*planetModel: prisma\.planet,/u,
  )
  assert.doesNotMatch(
    operation,
    /searchParams|formData|FormData|cookies|localStorage|sessionStorage|console\./u,
  )
})

test("rename action reads only planet ID and name before revalidation and redirect", async () => {
  const action = await source("app/planets/actions.js")

  assert.match(action, /^"use server";/u)
  assert.match(action, /formData\.get\("planetId"\)/u)
  assert.match(action, /formData\.get\("planetName"\)/u)
  assert.equal((action.match(/formData\.get\(/gu) ?? []).length, 2)
  assert.match(
    action,
    /await renameAuthenticatedUserPlanet\(planetId, planetName\)/u,
  )
  assert.match(action, /revalidatePath\("\/planets"\)/u)
  assert.match(action, /revalidatePath\(planetPath\)/u)
  assert.match(action, /redirect\(planetPath\)/u)
  assert.doesNotMatch(action, /ownerId|userId|console\./u)
})

test("detail page renders name and ID with a server-action rename form", async () => {
  const page = await source("app/planets/[planetId]/page.js")

  assert.doesNotMatch(page, /^['"]use client['"]/mu)
  assert.match(page, /<h1 id="planet-title">\{planet\.name\}<\/h1>/u)
  assert.match(page, /<p className="planet-id">\{planet\.id\}<\/p>/u)
  assert.match(page, /<form action=\{renamePlanetAction\}/u)
  assert.match(page, /<input name="planetId" type="hidden" value=\{planet\.id\} \/>/u)
  assert.match(page, /<label htmlFor="planet-name">Planet name<\/label>/u)
  assert.match(page, /defaultValue=\{planet\.name\}/u)
  assert.match(page, /name="planetName"/u)
  assert.match(page, />\s*Rename planet\s*<\/button>/u)
  assert.doesNotMatch(page, /ownerId|userId|dangerouslySetInnerHTML|console\./u)
})

test("local rename is owner-scoped, defaults names, and rolls back all data", async () => {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
  const testId = randomUUID()
  const ownerId = `planet-rename-owner-${testId}`
  const otherOwnerId = `planet-rename-other-${testId}`
  const ownedPlanetId = `planet-rename-owned-${testId}`
  const otherPlanetId = `planet-rename-foreign-${testId}`

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])

    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.user.createMany({
          data: [
            {
              id: ownerId,
              name: "Planet Rename Owner",
              email: `${ownerId}@example.invalid`,
            },
            {
              id: otherOwnerId,
              name: "Planet Rename Other",
              email: `${otherOwnerId}@example.invalid`,
            },
          ],
        })
        await transaction.planet.createMany({
          data: [
            { id: ownedPlanetId, ownerId },
            { id: otherPlanetId, ownerId: otherOwnerId },
          ],
        })

        assert.deepEqual(
          await transaction.planet.findUnique({
            where: { id: ownedPlanetId },
            select: { id: true, name: true },
          }),
          { id: ownedPlanetId, name: "Unnamed Planet" },
        )

        assert.deepEqual(
          await renamePlanetForOwner({
            ownerId,
            planetId: ownedPlanetId,
            planetName: "  Polaris Station  ",
            planetModel: transaction.planet,
          }),
          { id: ownedPlanetId },
        )
        assert.equal(
          await transaction.planet.count({
            where: { id: ownedPlanetId, ownerId, name: "Polaris Station" },
          }),
          1,
        )

        await assert.rejects(
          renamePlanetForOwner({
            ownerId,
            planetId: otherPlanetId,
            planetName: "Stolen name",
            planetModel: transaction.planet,
          }),
          { message: PLANET_RENAME_ERROR },
        )
        await assert.rejects(
          renamePlanetForOwner({
            ownerId,
            planetId: `planet-rename-missing-${testId}`,
            planetName: "Missing name",
            planetModel: transaction.planet,
          }),
          { message: PLANET_RENAME_ERROR },
        )
        assert.deepEqual(
          await transaction.planet.findUnique({
            where: { id: otherPlanetId },
            select: { name: true },
          }),
          { name: "Unnamed Planet" },
        )

        throw ROLLBACK_SENTINEL
      }),
      (error) => error === ROLLBACK_SENTINEL,
    )

    assert.equal(
      await prisma.planet.count({
        where: { id: { in: [ownedPlanetId, otherPlanetId] } },
      }),
      0,
    )
    assert.equal(
      await prisma.user.count({
        where: { id: { in: [ownerId, otherOwnerId] } },
      }),
      0,
    )
  } finally {
    await prisma.$disconnect()
  }
})
