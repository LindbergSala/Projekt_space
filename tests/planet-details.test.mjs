import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  isValidPlanetId,
  queryOwnedPlanetById,
} from "../lib/owned-planets-query.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const ROLLBACK_SENTINEL = new Error("rollback planet-details test data")

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

test("planet list links names and IDs without changing its empty-state action", async () => {
  const page = await source("app/planets/page.js")

  assert.match(page, /import Link from ["']next\/link["']/u)
  assert.match(page, /planets\.map\(\(planet\) =>/u)
  assert.match(page, /href=\{`\/planets\/\$\{encodeURIComponent\(planet\.id\)\}`\}/u)
  assert.match(page, /\{planet\.name\}/u)
  assert.match(page, /\{planet\.id\}/u)
  assert.match(page, />You do not have any planets yet\.<\/p>/u)
  assert.match(page, /action=\{establishFirstPlanetAction\}/u)
  assert.match(page, />\s*Establish first planet\s*<\/button>/u)
})

test("authenticated detail operation derives owner identity on the server", async () => {
  const operation = await source("lib/owned-planets.js")

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    operation,
    /export async function getAuthenticatedUserPlanetById\(planetId\)/u,
  )
  assert.match(operation, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.match(
    operation,
    /queryOwnedPlanetDetailForOwner\(\{\s*planetId,\s*ownerId,/u,
  )
  assert.doesNotMatch(
    operation,
    /searchParams|formData|FormData|cookies|localStorage|sessionStorage|console\./u,
  )
})

test("owned planet detail query selects only ID, name, and exact Materials", async () => {
  let receivedQuery
  const planet = await queryOwnedPlanetById({
    planetId: "planet-owned",
    ownerId: "authenticated-owner",
    factionKey: "orthevan-directorate",
    planetModel: {
      async findFirst(query) {
        receivedQuery = query
        return {
          id: "planet-owned",
          name: "Owned Planet",
          materials: 9_007_199_254_740_993n,
          materialTransactions: [],
          unitTransactions: [],
        }
      },
    },
  })

  assert.deepEqual(receivedQuery, {
    where: {
      id: "planet-owned",
      ownerId: "authenticated-owner",
    },
    select: {
      id: true,
      name: true,
      materials: true,
      materialTransactions: {
        select: {
          delta: true,
          balanceAfter: true,
          createdAt: true,
        },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: 20,
      },
      unitTransactions: {
        select: {
          unitKey: true,
          delta: true,
          quantityAfter: true,
          createdAt: true,
        },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: 20,
      },
    },
  })
  assert.deepEqual(planet, {
    id: "planet-owned",
    name: "Owned Planet",
    materials: "9007199254740993",
    materialHistory: [],
    unitHistory: [],
  })
})

test("invalid planet IDs return null without querying the database", async () => {
  const invalidPlanetIds = [
    undefined,
    null,
    "",
    "   ",
    " padded ",
    "x".repeat(129),
    123,
  ]
  let queryCount = 0
  const planetModel = {
    async findFirst() {
      queryCount += 1
      return { id: "unsafe-result" }
    },
  }

  for (const planetId of invalidPlanetIds) {
    assert.equal(isValidPlanetId(planetId), false)
    assert.equal(
      await queryOwnedPlanetById({
        planetId,
        ownerId: "authenticated-owner",
        factionKey: "orthevan-directorate",
        planetModel,
      }),
      null,
    )
  }

  assert.equal(queryCount, 0)
  assert.equal(isValidPlanetId("x".repeat(128)), true)
})

test("planet detail page awaits params and hides missing or foreign planets", async () => {
  const page = await source("app/planets/[planetId]/page.js")

  assert.doesNotMatch(page, /^["']use client["']/mu)
  assert.match(page, /const \{ planetId \} = await params/u)
  assert.match(page, /getAuthenticatedUserPlanetById\(planetId\)/u)
  assert.match(page, /getAuthenticatedPlanetaryForces\(planetId\)/u)
  assert.match(
    page,
    /if \(planet === null \|\| forces === null\) \{\s*notFound\(\)/u,
  )
  assert.match(page, /<h1 id="planet-title">\{planet\.name\}<\/h1>/u)
  assert.match(page, /<p className="planet-id">\{planet\.id\}<\/p>/u)
  assert.match(page, /<dt>Stored Materials<\/dt>/u)
  assert.match(page, /<dd>\{planet\.materials\}<\/dd>/u)
  assert.match(page, />Materials history<\/h2>/u)
  assert.match(page, />No material changes yet\.<\/p>/u)
  assert.match(page, /href="\/planets"/u)
  assert.match(page, />\s*Back to planets\s*<\/Link>/u)
  assert.doesNotMatch(
    page,
    /ownerId|userId|\b(?:create|update|upsert|delete)\b|console\./u,
  )
})

test("local detail queries isolate owners and roll back all synthetic data", async () => {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
  const testId = randomUUID()
  const firstOwnerId = `planet-detail-first-${testId}`
  const secondOwnerId = `planet-detail-second-${testId}`
  const firstPlanetId = `planet-detail-owned-${testId}`
  const secondPlanetId = `planet-detail-foreign-${testId}`

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
              name: "First Planet Detail Probe",
              email: `${firstOwnerId}@example.invalid`,
            },
            {
              id: secondOwnerId,
              name: "Second Planet Detail Probe",
              email: `${secondOwnerId}@example.invalid`,
            },
          ],
        })
        await transaction.planet.createMany({
          data: [
            { id: firstPlanetId, ownerId: firstOwnerId },
            { id: secondPlanetId, ownerId: secondOwnerId },
          ],
        })

        assert.deepEqual(
          await queryOwnedPlanetById({
            planetId: firstPlanetId,
            ownerId: firstOwnerId,
            factionKey: "orthevan-directorate",
            planetModel: transaction.planet,
          }),
          {
            id: firstPlanetId,
            name: "Unnamed Planet",
            materials: "0",
            materialHistory: [],
            unitHistory: [],
          },
        )
        assert.equal(
          await queryOwnedPlanetById({
            planetId: secondPlanetId,
            ownerId: firstOwnerId,
            factionKey: "orthevan-directorate",
            planetModel: transaction.planet,
          }),
          null,
        )
        assert.equal(
          await queryOwnedPlanetById({
            planetId: `planet-detail-unknown-${testId}`,
            ownerId: firstOwnerId,
            factionKey: "orthevan-directorate",
            planetModel: transaction.planet,
          }),
          null,
        )

        throw ROLLBACK_SENTINEL
      }),
      (error) => error === ROLLBACK_SENTINEL,
    )

    assert.equal(
      await prisma.planet.count({
        where: { id: { in: [firstPlanetId, secondPlanetId] } },
      }),
      0,
    )
    assert.equal(
      await prisma.user.count({
        where: { id: { in: [firstOwnerId, secondOwnerId] } },
      }),
      0,
    )
  } finally {
    await prisma.$disconnect()
  }
})
