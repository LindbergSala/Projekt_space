import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { queryOwnedPlanets } from "../lib/owned-planets-query.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const ROLLBACK_SENTINEL = new Error("rollback owned-planet test data")

test("server operation derives ownership from the authenticated session", async () => {
  const source = await readFile(
    path.join(ROOT_DIRECTORY, "lib/owned-planets.js"),
    "utf8",
  )

  assert.match(source, /^import "server-only"$/mu)
  assert.match(
    source,
    /export async function getAuthenticatedUserPlanets\(\)/u,
  )
  assert.match(source, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.match(source, /ownerId,/u)
  assert.match(source, /planetModel: prisma\.planet/u)
  assert.doesNotMatch(source, /request|searchParams|formData|params|console\./u)
})

test("owned-planet query filters by owner and selects only ordered names and IDs", async () => {
  let query
  const planets = await queryOwnedPlanets({
    ownerId: "authenticated-owner",
    planetModel: {
      findMany: async (receivedQuery) => {
        query = receivedQuery
        return [
          { id: "planet-a", name: "Alpha" },
          { id: "planet-b", name: "Beta" },
        ]
      },
    },
  })

  assert.deepEqual(query, {
    where: { ownerId: "authenticated-owner" },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  })
  assert.deepEqual(planets, [
    { id: "planet-a", name: "Alpha" },
    { id: "planet-b", name: "Beta" },
  ])
})

test("owned-planet query excludes another owner and returns an empty list", async () => {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
  const firstOwnerId = `owned-planets-first-${randomUUID()}`
  const secondOwnerId = `owned-planets-second-${randomUUID()}`
  const emptyOwnerId = `owned-planets-empty-${randomUUID()}`
  const firstPlanetIds = [
    `owned-planets-z-${randomUUID()}`,
    `owned-planets-a-${randomUUID()}`,
  ]
  const secondPlanetId = `owned-planets-other-${randomUUID()}`

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
              id: firstOwnerId,
              name: "First Ownership Probe",
              email: `${firstOwnerId}@example.invalid`,
            },
            {
              id: secondOwnerId,
              name: "Second Ownership Probe",
              email: `${secondOwnerId}@example.invalid`,
            },
            {
              id: emptyOwnerId,
              name: "Empty Ownership Probe",
              email: `${emptyOwnerId}@example.invalid`,
            },
          ],
        })
        await transaction.planet.createMany({
          data: [
            { id: firstPlanetIds[0], ownerId: firstOwnerId },
            { id: secondPlanetId, ownerId: secondOwnerId },
            { id: firstPlanetIds[1], ownerId: firstOwnerId },
          ],
        })

        assert.deepEqual(
          await queryOwnedPlanets({
            ownerId: firstOwnerId,
            planetModel: transaction.planet,
          }),
          [...firstPlanetIds]
            .sort()
            .map((id) => ({ id, name: "Unnamed Planet" })),
        )
        assert.deepEqual(
          await queryOwnedPlanets({
            ownerId: emptyOwnerId,
            planetModel: transaction.planet,
          }),
          [],
        )

        throw ROLLBACK_SENTINEL
      }),
      (error) => error === ROLLBACK_SENTINEL,
    )

    assert.equal(
      await prisma.user.count({
        where: { id: { in: [firstOwnerId, secondOwnerId, emptyOwnerId] } },
      }),
      0,
    )
    assert.equal(
      await prisma.planet.count({
        where: { id: { in: [...firstPlanetIds, secondPlanetId] } },
      }),
      0,
    )
  } finally {
    await prisma.$disconnect()
  }
})
