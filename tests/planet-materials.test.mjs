import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { queryOwnedPlanetById } from "../lib/owned-planets-query.js"
import { renamePlanetForOwner } from "../lib/planet-name-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const LARGE_MATERIALS = 9_007_199_254_740_993n

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

test("Planet schema and migration define only non-negative BIGINT Materials", async () => {
  const schema = await source("prisma/schema.prisma")
  const migrationDirectories = await readdir(
    path.join(ROOT_DIRECTORY, "prisma/migrations"),
    { withFileTypes: true },
  )
  const materialsMigration = migrationDirectories.find(
    (entry) =>
      entry.isDirectory() && entry.name.endsWith("_add_planet_materials"),
  )

  assert.match(
    schema,
    /materials\s+BigInt\s+@default\(0\)\s+@db\.BigInt/u,
  )
  assert.ok(
    materialsMigration,
    "expected the generated add_planet_materials migration",
  )

  const migration = await source(
    `prisma/migrations/${materialsMigration.name}/migration.sql`,
  )
  assert.equal(
    migration.replaceAll("\r\n", "\n").trim(),
    [
      "-- AlterTable",
      'ALTER TABLE "planet" ADD COLUMN     "materials" BIGINT NOT NULL DEFAULT 0;',
      "",
      "-- AddCheckConstraint",
      'ALTER TABLE "planet" ADD CONSTRAINT "planet_materials_nonnegative" CHECK ("materials" >= 0);',
    ].join("\n"),
  )
  assert.doesNotMatch(
    migration,
    /DROP|DELETE|TRUNCATE|CREATE TABLE|ALTER COLUMN|RENAME|ownerId|FOREIGN KEY/iu,
  )
})

test("Materials is serialized exactly and never selected by the planet list", async () => {
  const query = await source("lib/owned-planets-query.js")

  assert.match(query, /materials: planet\.materials\.toString\(\)/u)
  assert.doesNotMatch(query, /Number\(planet\.materials\)/u)

  let detailQuery
  const planet = await queryOwnedPlanetById({
    planetId: "planet-owned",
    ownerId: "authenticated-owner",
    factionKey: "orthevan-directorate",
    planetModel: {
      async findFirst(receivedQuery) {
        detailQuery = receivedQuery
        return {
          id: "planet-owned",
          name: "Owned Planet",
          materials: LARGE_MATERIALS,
          materialTransactions: [],
          unitTransactions: [],
        }
      },
    },
  })

  assert.deepEqual(detailQuery, {
    where: { id: "planet-owned", ownerId: "authenticated-owner" },
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

  const listFunction = query.match(
    /export async function queryOwnedPlanets[\s\S]*?\n\}/u,
  )?.[0]
  assert.ok(listFunction)
  assert.doesNotMatch(listFunction, /materials/u)
})

test("planet detail renders stored Materials with only the bounded production claim", async () => {
  const page = await source("app/planets/[planetId]/page.js")
  const actions = await source("app/planets/actions.js")

  assert.doesNotMatch(page, /^['"]use client['"]/mu)
  assert.match(page, /<h2 id="resources-title">Resources<\/h2>/u)
  assert.match(page, /<dt>Stored Materials<\/dt>/u)
  assert.match(page, /<dd>\{planet\.materials\}<\/dd>/u)
  assert.doesNotMatch(page, /name="materials"|name="Materials"/u)
  assert.match(actions, /claimPlanetMaterialsProductionAction/u)
  assert.doesNotMatch(
    actions,
    /applyAuthenticatedPlanetMaterialsTransaction|operationKey|\bdelta\b/u,
  )
})

test("local PostgreSQL enforces defaults, precision, ownership, and rename preservation", async () => {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
  const testId = randomUUID()
  const ownerId = `materials-owner-${testId}`
  const otherOwnerId = `materials-other-${testId}`
  const planetId = `materials-planet-${testId}`
  const otherPlanetId = `materials-foreign-${testId}`

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])

    const column = await prisma.$queryRaw`
      SELECT data_type,
             is_nullable,
             column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'planet'
         AND column_name = 'materials'
    `
    assert.deepEqual(column, [{
      data_type: "bigint",
      is_nullable: "NO",
      column_default: "0",
    }])

    const constraints = await prisma.$queryRaw`
      SELECT pg_get_constraintdef(constraint_entry.oid) AS definition
        FROM pg_catalog.pg_constraint AS constraint_entry
        JOIN pg_catalog.pg_class AS class_entry
          ON class_entry.oid = constraint_entry.conrelid
        JOIN pg_catalog.pg_namespace AS namespace_entry
          ON namespace_entry.oid = class_entry.relnamespace
       WHERE namespace_entry.nspname = 'public'
         AND class_entry.relname = 'planet'
         AND constraint_entry.conname = 'planet_materials_nonnegative'
    `
    assert.equal(constraints.length, 1)
    assert.match(constraints[0].definition, /^CHECK \(\(materials >= 0\)\)$/u)

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Materials Owner",
          email: `${ownerId}@example.invalid`,
        },
        {
          id: otherOwnerId,
          name: "Materials Other Owner",
          email: `${otherOwnerId}@example.invalid`,
        },
      ],
    })
    await prisma.planet.createMany({
      data: [
        { id: planetId, ownerId },
        { id: otherPlanetId, ownerId: otherOwnerId },
      ],
    })

    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { materials: true },
      }),
      { materials: 0n },
    )

    await assert.rejects(
      prisma.planet.update({
        where: { id: planetId },
        data: { materials: -1n },
      }),
    )
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { materials: true },
      }),
      { materials: 0n },
    )

    await prisma.planet.update({
      where: { id: planetId },
      data: { materials: LARGE_MATERIALS },
    })
    assert.deepEqual(
      await queryOwnedPlanetById({
        planetId,
        ownerId,
        factionKey: "orthevan-directorate",
        planetModel: prisma.planet,
      }),
      {
        id: planetId,
        name: "Unnamed Planet",
        materials: "9007199254740993",
        materialHistory: [],
        unitHistory: [],
      },
    )
    assert.equal(
      await queryOwnedPlanetById({
        planetId: otherPlanetId,
        ownerId,
        factionKey: "orthevan-directorate",
        planetModel: prisma.planet,
      }),
      null,
    )

    await renamePlanetForOwner({
      ownerId,
      planetId,
      planetName: "Materials Prime",
      planetModel: prisma.planet,
    })
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { name: true, materials: true },
      }),
      { name: "Materials Prime", materials: LARGE_MATERIALS },
    )
  } finally {
    await prisma.planet.deleteMany({
      where: { id: { in: [planetId, otherPlanetId] } },
    }).catch(() => {})
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherOwnerId] } },
    }).catch(() => {})

    assert.equal(
      await prisma.planet.count({
        where: { id: { in: [planetId, otherPlanetId] } },
      }),
      0,
    )
    assert.equal(
      await prisma.user.count({
        where: { id: { in: [ownerId, otherOwnerId] } },
      }),
      0,
    )
    await prisma.$disconnect()
  }
})
