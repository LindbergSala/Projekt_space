import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"
import {
  createStarterPlanetId,
  ensureStarterPlanetForOwner,
} from "../lib/starter-planet-policy.js"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const OWNERSHIP_ERROR = "Unable to establish the starter planet."

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function createMemoryPrismaClient({ factionKey = "orthevan-directorate" } = {}) {
  const planets = new Map()
  let createCount = 0

  const planet = {
    async findFirst({ where, select, orderBy }) {
      assert.deepEqual(select, { id: true, ownerId: true })
      assert.deepEqual(orderBy, { id: "asc" })
      return [...planets.values()]
        .filter(({ ownerId }) => ownerId === where.ownerId)
        .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null
    },
    async upsert({ where, update, create, select }) {
      assert.deepEqual(where, { id: create.id })
      assert.deepEqual(update, {})
      assert.deepEqual(select, { id: true, ownerId: true })
      const existing = planets.get(where.id)
      if (existing !== undefined) {
        return existing
      }

      createCount += 1
      planets.set(create.id, { ...create })
      return planets.get(create.id)
    },
  }

  return {
    get createCount() {
      return createCount
    },
    async $transaction(run) {
      return run({
        $queryRaw: async () => [{ factionKey }],
        planet,
      })
    },
  }
}

test("authenticated starter operation is server-only and parameterless", async () => {
  const operation = await source("lib/owned-planets.js")

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    operation,
    /export async function ensureAuthenticatedUserStarterPlanet\(\)/u,
  )
  assert.match(operation, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.doesNotMatch(
    operation,
    /request|searchParams|formData|FormData|params|cookies|localStorage|sessionStorage|console\./u,
  )
})

test("starter planet ID is deterministic, opaque, and domain-versioned", async () => {
  const policy = await source("lib/starter-planet-policy.js")
  const ownerId = "visible-owner-id"
  const planetId = createStarterPlanetId(ownerId)

  assert.equal(planetId, createStarterPlanetId(ownerId))
  assert.notEqual(planetId, createStarterPlanetId("another-owner-id"))
  assert.match(planetId, /^planet_[a-f0-9]{64}$/u)
  assert.equal(planetId.includes(ownerId), false)
  assert.match(
    policy,
    /STARTER_PLANET_ID_DOMAIN = "projekt-space\/starter-planet\/v1\\0"/u,
  )
})

test("a missing planet is created once and repeated calls return it", async () => {
  const prismaClient = createMemoryPrismaClient()
  const ownerId = "authenticated-owner"

  const firstId = await ensureStarterPlanetForOwner({ ownerId, prismaClient })
  const secondId = await ensureStarterPlanetForOwner({ ownerId, prismaClient })

  assert.equal(firstId, createStarterPlanetId(ownerId))
  assert.equal(secondId, firstId)
  assert.equal(prismaClient.createCount, 1)
})

test("the deterministic first existing planet prevents starter creation", async () => {
  let upsertCalled = false
  const planetId = await ensureStarterPlanetForOwner({
    ownerId: "authenticated-owner",
    prismaClient: {
      async $transaction(run) {
        return run({
          $queryRaw: async () => [{ factionKey: "orthevan-directorate" }],
          planet: {
            async findFirst(query) {
              assert.deepEqual(query, {
                where: { ownerId: "authenticated-owner" },
                select: { id: true, ownerId: true },
                orderBy: { id: "asc" },
              })
              return { id: "planet-a", ownerId: "authenticated-owner" }
            },
            async upsert() {
              upsertCalled = true
            },
          },
        })
      },
    },
  })

  assert.equal(planetId, "planet-a")
  assert.equal(upsertCalled, false)
})

test("ownership verification fails closed with a generic error", async () => {
  await assert.rejects(
    ensureStarterPlanetForOwner({
      ownerId: "authenticated-owner",
      prismaClient: {
        async $transaction(run) {
          return run({
            $queryRaw: async () => [{ factionKey: "orthevan-directorate" }],
            planet: {
              async findFirst() {
                return null
              },
              async upsert() {
                return { id: "colliding-planet", ownerId: "another-owner" }
              },
            },
          })
        },
      },
    }),
    { message: OWNERSHIP_ERROR },
  )
})

test("planet rendering is read-only and mutation requires the empty-state form", async () => {
  const page = await source("app/planets/page.js")
  const action = await source("app/planets/actions.js")

  assert.match(page, /const planets = await getAuthenticatedUserPlanets\(\)/u)
  assert.doesNotMatch(page, /ensureAuthenticatedUserStarterPlanet\(/u)
  assert.match(page, /planets\.length === 0/u)
  assert.match(page, /<form\s+action=\{establishFirstPlanetAction\}/u)
  assert.match(page, />\s*Establish first planet\s*<\/button>/u)
  assert.equal((page.match(/<form/gu) ?? []).length, 1)
  assert.doesNotMatch(page, /<input|ownerId|userId/u)

  assert.match(action, /^"use server";/u)
  assert.match(action, /export async function establishFirstPlanetAction\(\)/u)
  assert.match(action, /await ensureAuthenticatedUserStarterPlanet\(\)/u)
  assert.match(action, /redirect\("\/planets"\)/u)
  const establishAction = action.match(
    /export async function establishFirstPlanetAction\(\) \{[\s\S]*?\n\}/u,
  )?.[0]
  assert.ok(establishAction)
  assert.doesNotMatch(
    establishAction,
    /userId|formData|FormData|searchParams|params|cookies|localStorage|sessionStorage/u,
  )
})

test("local database creation is idempotent, concurrent, isolated, and cleaned up", async () => {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
  const testId = randomUUID()
  const newOwnerId = `starter-new-${testId}`
  const concurrentOwnerId = `starter-concurrent-${testId}`
  const existingOwnerId = `starter-existing-${testId}`
  const otherOwnerId = `starter-other-${testId}`
  const collisionOwnerId = `starter-collision-${testId}`
  const ownerIds = [
    newOwnerId,
    concurrentOwnerId,
    existingOwnerId,
    otherOwnerId,
    collisionOwnerId,
  ]
  const existingPlanetIds = [
    `starter-existing-z-${testId}`,
    `starter-existing-a-${testId}`,
  ]
  const otherPlanetId = `starter-other-${testId}`
  const collidingPlanetId = createStarterPlanetId(collisionOwnerId)

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])

    await prisma.user.createMany({
      data: ownerIds.map((id) => ({
        id,
        name: "Starter Planet Probe",
        email: `${id}@example.invalid`,
        factionKey: "orthevan-directorate",
      })),
    })
    await prisma.planet.createMany({
      data: [
        ...existingPlanetIds.map((id) => ({ id, ownerId: existingOwnerId })),
        { id: otherPlanetId, ownerId: otherOwnerId },
        { id: collidingPlanetId, ownerId: otherOwnerId },
      ],
    })

    const newPlanetId = await ensureStarterPlanetForOwner({
      ownerId: newOwnerId,
      prismaClient: prisma,
    })
    assert.equal(
      await ensureStarterPlanetForOwner({
        ownerId: newOwnerId,
        prismaClient: prisma,
      }),
      newPlanetId,
    )
    assert.equal(await prisma.planet.count({ where: { ownerId: newOwnerId } }), 1)
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: newPlanetId },
        select: { id: true, name: true, materials: true },
      }),
      { id: newPlanetId, name: "Unnamed Planet", materials: 0n },
    )
    assert.equal(
      await prisma.planetUnitStack.count({ where: { planetId: newPlanetId } }),
      0,
    )

    const concurrentIds = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureStarterPlanetForOwner({
          ownerId: concurrentOwnerId,
          prismaClient: prisma,
        }),
      ),
    )
    assert.deepEqual(new Set(concurrentIds), new Set([
      createStarterPlanetId(concurrentOwnerId),
    ]))
    assert.equal(
      await prisma.planet.count({ where: { ownerId: concurrentOwnerId } }),
      1,
    )

    assert.equal(
      await ensureStarterPlanetForOwner({
        ownerId: existingOwnerId,
        prismaClient: prisma,
      }),
      existingPlanetIds[1],
    )
    assert.equal(
      await prisma.planet.count({ where: { ownerId: existingOwnerId } }),
      2,
    )

    await assert.rejects(
      ensureStarterPlanetForOwner({
        ownerId: collisionOwnerId,
        prismaClient: prisma,
      }),
      { message: OWNERSHIP_ERROR },
    )
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: collidingPlanetId },
        select: { id: true, ownerId: true },
      }),
      { id: collidingPlanetId, ownerId: otherOwnerId },
    )
    assert.equal(
      await prisma.planet.count({ where: { ownerId: otherOwnerId } }),
      2,
    )
  } finally {
    const planets = await prisma.planet.findMany({
      where: { ownerId: { in: ownerIds } },
      select: { id: true },
    })
    await prisma.planetUnitStack.deleteMany({
      where: { planetId: { in: planets.map((planet) => planet.id) } },
    })
    await prisma.planet.deleteMany({ where: { ownerId: { in: ownerIds } } })
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } })

    assert.equal(
      await prisma.planet.count({ where: { ownerId: { in: ownerIds } } }),
      0,
    )
    assert.equal(await prisma.user.count({ where: { id: { in: ownerIds } } }), 0)
    await prisma.$disconnect()
  }
})
