import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  CIVILIZATION_RESET_SCOPE,
  RESET_CIVILIZATION_CONFIRMATION,
  resetCivilizationForUser,
} from "../lib/civilization-policy.js"
import {
  PLANETARY_FORCES_ERROR,
  queryPlanetaryForcesForOwner,
} from "../lib/planetary-forces-policy.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
  getPlanetaryUnits,
} from "../lib/planetary-units.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const FACTION_KEYS = getPlanetaryFactionSummaries().map(({ key }) => key)
const TABLE_DELEGATES = [
  ["User", "user"],
  ["Account", "account"],
  ["Session", "session"],
  ["Verification", "verification"],
  ["Planet", "planet"],
  ["PlanetMaterialTransaction", "planetMaterialTransaction"],
  ["PlanetUnitStack", "planetUnitStack"],
  ["PlanetUnitTransaction", "planetUnitTransaction"],
]

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function localPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
}

async function rowCounts(prisma) {
  return Object.fromEntries(
    await Promise.all(
      TABLE_DELEGATES.map(async ([label, delegate]) => [
        label,
        await prisma[delegate].count(),
      ]),
    ),
  )
}

function memoryPlanetModel(unitStacks = [], planetId = "planet-owned") {
  let query

  return {
    get query() {
      return query
    },
    async findFirst(receivedQuery) {
      query = receivedQuery
      return planetId === null ? null : { id: planetId, unitStacks }
    },
  }
}

test("schema and migration create only the constrained per-planet stack table", async () => {
  const schema = await source("prisma/schema.prisma")
  const directories = await readdir(path.join(ROOT_DIRECTORY, "prisma/migrations"), {
    withFileTypes: true,
  })
  const migrationDirectory = directories.find(
    (entry) => entry.isDirectory() && entry.name.endsWith("_add_planet_unit_stacks"),
  )

  assert.match(schema, /unitStacks\s+PlanetUnitStack\[\]/u)
  assert.match(
    schema,
    /model PlanetUnitStack \{[\s\S]*planetId\s+String[\s\S]*unitKey\s+String\s+@db\.VarChar\(32\)[\s\S]*quantity\s+BigInt\s+@default\(0\)\s+@db\.BigInt[\s\S]*@@id\(\[planetId, unitKey\], map: "planet_unit_stack_pkey"\)[\s\S]*@@map\("planet_unit_stack"\)[\s\S]*\}/u,
  )
  assert.ok(migrationDirectory)

  const migration = await source(
    `prisma/migrations/${migrationDirectory.name}/migration.sql`,
  )
  assert.equal((migration.match(/CREATE TABLE/gu) ?? []).length, 1)
  assert.match(migration, /CREATE TABLE "planet_unit_stack"/u)
  const tableBody = migration.match(
    /CREATE TABLE "planet_unit_stack" \(([\s\S]*?)\n\);/u,
  )?.[1]
  assert.ok(tableBody)
  assert.deepEqual(
    [...tableBody.matchAll(/^\s+"([^"]+)"\s/gmu)].map((match) => match[1]),
    ["planetId", "unitKey", "quantity"],
  )
  assert.match(migration, /"quantity" BIGINT NOT NULL DEFAULT 0/u)
  assert.match(
    migration,
    /CONSTRAINT "planet_unit_stack_pkey" PRIMARY KEY \("planetId", "unitKey"\)/u,
  )
  assert.match(migration, /planet_unit_stack_quantity_nonnegative" CHECK \("quantity" >= 0\)/u)
  assert.match(migration, /planet_unit_stack_unitKey_valid" CHECK/u)
  assert.match(
    migration,
    /REFERENCES "planet"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/u,
  )
  assert.doesNotMatch(
    migration,
    /^\s*(?:CREATE INDEX|INSERT|UPDATE|DELETE|CREATE TRIGGER|CREATE FUNCTION|GRANT)\b/imu,
  )
  assert.equal((migration.match(/ALTER TABLE/gu) ?? []).length, 3)
  assert.equal(
    (migration.match(/ALTER TABLE "planet_unit_stack"/gu) ?? []).length,
    3,
  )
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(?:user|account|session|verification|planet|planet_material_transaction)"/u,
  )

  const migrationKeys = [...migration.matchAll(/'([^']+)'/gu)].map(
    (match) => match[1],
  )
  const registryKeys = getPlanetaryUnits().map(({ key }) => key)
  assert.deepEqual(migrationKeys, registryKeys)
  assert.equal(new Set(migrationKeys).size, 15)
})

test("owner-protected query returns the faction roster in exact BigInt-safe shape", async () => {
  const planetModel = memoryPlanetModel([
    { unitKey: "line-infantry", quantity: 9_007_199_254_740_993n },
    { unitKey: "siege-strider", quantity: 2n },
  ])
  const result = await queryPlanetaryForcesForOwner({
    planetId: "planet-owned",
    ownerId: "authenticated-owner",
    factionKey: "orthevan-directorate",
    planetModel,
  })

  assert.deepEqual(planetModel.query, {
    where: { id: "planet-owned", ownerId: "authenticated-owner" },
    select: {
      id: true,
      unitStacks: {
        select: { unitKey: true, quantity: true },
      },
    },
  })
  assert.equal(result.id, "planet-owned")
  assert.equal(result.units.length, 9)
  assert.deepEqual(
    result.units.map(({ key }) => key),
    getPlanetaryRosterForFaction("orthevan-directorate").map(({ key }) => key),
  )
  assert.deepEqual(Object.keys(result.units[0]), ["key", "name", "category", "quantity"])
  assert.equal(result.units[0].quantity, "9007199254740993")
  assert.equal(result.units[1].quantity, "0")
  assert.equal(result.units.at(-1).quantity, "2")
})

test("invalid, missing, foreign, and corrupt force reads fail closed", async () => {
  let queryCount = 0
  const neverQuery = {
    async findFirst() {
      queryCount += 1
      return null
    },
  }
  for (const planetId of [undefined, null, "", " padded ", "x".repeat(129)]) {
    assert.equal(
      await queryPlanetaryForcesForOwner({
        planetId,
        ownerId: "authenticated-owner",
        factionKey: "orthevan-directorate",
        planetModel: neverQuery,
      }),
      null,
    )
  }
  assert.equal(queryCount, 0)

  for (const planetId of ["missing-planet", "foreign-planet"]) {
    assert.equal(
      await queryPlanetaryForcesForOwner({
        planetId,
        ownerId: "authenticated-owner",
        factionKey: "orthevan-directorate",
        planetModel: memoryPlanetModel([], null),
      }),
      null,
    )
  }

  for (const unitStacks of [
    [{ unitKey: "razor-beast", quantity: 1n }],
    [{ unitKey: "unknown-unit", quantity: 1n }],
    [{ unitKey: "line-infantry", quantity: -1n }],
    [{ unitKey: "line-infantry", quantity: 1 }],
    [
      { unitKey: "line-infantry", quantity: 1n },
      { unitKey: "line-infantry", quantity: 2n },
    ],
  ]) {
    await assert.rejects(
      queryPlanetaryForcesForOwner({
        planetId: "planet-owned",
        ownerId: "authenticated-owner",
        factionKey: "orthevan-directorate",
        planetModel: memoryPlanetModel(unitStacks),
      }),
      { message: PLANETARY_FORCES_ERROR },
    )
  }
})

test("all faction rosters contain seven general units followed by the correct uniques", async () => {
  const expectedUniqueKeys = {
    "orthevan-directorate": ["vanguard-exosuit", "siege-strider"],
    "zhyreth-brood": ["razor-beast", "spore-caster"],
    "nhalorin-continuum": ["aegis-construct", "phase-reaper"],
    "draskyr-clans": ["scrap-brute", "rift-raider"],
  }
  const expectedGeneralKeys = getPlanetaryRosterForFaction(FACTION_KEYS[0])
    .slice(0, 7)
    .map(({ key }) => key)

  for (const factionKey of FACTION_KEYS) {
    const result = await queryPlanetaryForcesForOwner({
      planetId: "planet-owned",
      ownerId: "authenticated-owner",
      factionKey,
      planetModel: memoryPlanetModel([]),
    })
    assert.deepEqual(result.units.slice(0, 7).map(({ key }) => key), expectedGeneralKeys)
    assert.deepEqual(result.units.slice(7).map(({ key }) => key), expectedUniqueKeys[factionKey])
    assert.equal(result.units.every(({ quantity }) => quantity === "0"), true)
  }
})

test("authenticated operation and planet UI remain server-only and read-only", async () => {
  const operation = await source("lib/owned-planets.js")
  const policy = await source("lib/planetary-forces-policy.js")
  const page = await source("app/planets/[planetId]/page.js")
  const styles = await source("app/globals.css")

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(operation, /export async function getAuthenticatedPlanetaryForces\(planetId\)/u)
  assert.match(operation, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.match(operation, /const faction = await requireFactionForAuthenticatedUserId\(ownerId\)/u)
  assert.match(operation, /factionKey: faction\.key/u)
  assert.doesNotMatch(operation, /searchParams|formData|localStorage|sessionStorage|console\./u)
  assert.doesNotMatch(policy, /\.create\(|\.update|\.upsert|\.delete|Number\(/u)

  assert.doesNotMatch(page, /^["']use client["']/mu)
  assert.match(page, />Planetary forces<\/h2>/u)
  assert.match(page, /forces\.units\.map\(\(unit\) =>/u)
  assert.match(page, /\{unit\.name\}/u)
  assert.match(page, /\{unit\.category\}/u)
  assert.match(page, /\{unit\.quantity\}/u)
  assert.match(page, /`\/units\/\$\{encodeURIComponent\(forces\.faction\.key\)\}`/u)
  const forceSection = page.match(
    /<section\s+className="planetary-forces"[\s\S]*?<\/section>/u,
  )?.[0]
  assert.ok(forceSection)
  assert.doesNotMatch(forceSection, /<form|<input|<button|recruit|train|Materials cost/iu)
  assert.match(page, /<h1 id="planet-title">\{planet\.name\}<\/h1>/u)
  assert.match(page, /<dt>Stored Materials<\/dt>/u)
  assert.match(page, />Materials history<\/h2>/u)
  assert.match(page, /action=\{renamePlanetAction\}/u)
  assert.match(styles, /\.planetary-forces \{[\s\S]*min-width: 0/u)
  assert.match(styles, /\.planetary-forces h3 \{[\s\S]*overflow-wrap: anywhere/u)
})

test("local database constraints, reads, reset isolation, and cleanup are exact", async () => {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const ownerIds = FACTION_KEYS.map((_, index) => `force-owner-${index}-${testId}`)
  const planetIds = FACTION_KEYS.map((_, index) => `force-planet-${index}-${testId}`)
  const secondOrthevanPlanetId = `force-planet-second-${testId}`
  const accountId = `force-account-${testId}`
  const sessionId = `force-session-${testId}`
  let baseline

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])
    baseline = await rowCounts(prisma)

    await prisma.user.createMany({
      data: ownerIds.map((id, index) => ({
        id,
        name: "Planetary forces probe",
        email: `${id}@example.invalid`,
        factionKey: FACTION_KEYS[index],
      })),
    })
    await prisma.account.create({
      data: {
        id: accountId,
        accountId: ownerIds[0],
        providerId: "credential",
        userId: ownerIds[0],
        password: "synthetic-hashed-password",
      },
    })
    await prisma.session.create({
      data: {
        id: sessionId,
        token: `force-token-${testId}`,
        userId: ownerIds[0],
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    })
    await prisma.planet.createMany({
      data: [
        ...planetIds.map((id, index) => ({ id, ownerId: ownerIds[index] })),
        { id: secondOrthevanPlanetId, ownerId: ownerIds[0] },
      ],
    })

    await prisma.planetUnitStack.create({
      data: { planetId: planetIds[0], unitKey: "line-infantry" },
    })
    assert.equal(
      (await prisma.planetUnitStack.findUnique({
        where: {
          planetId_unitKey: { planetId: planetIds[0], unitKey: "line-infantry" },
        },
      })).quantity,
      0n,
    )
    await prisma.planetUnitStack.createMany({
      data: [
        {
          planetId: planetIds[0],
          unitKey: "assault-infantry",
          quantity: 9_007_199_254_740_993n,
        },
        { planetId: secondOrthevanPlanetId, unitKey: "line-infantry", quantity: 4n },
      ],
    })

    await assert.rejects(
      prisma.planetUnitStack.create({
        data: { planetId: planetIds[0], unitKey: "heavy-tank", quantity: -1n },
      }),
    )
    await assert.rejects(
      prisma.planetUnitStack.create({
        data: { planetId: planetIds[0], unitKey: "invalid-unit", quantity: 1n },
      }),
    )
    await assert.rejects(
      prisma.planetUnitStack.create({
        data: { planetId: `missing-${testId}`, unitKey: "line-infantry", quantity: 1n },
      }),
    )
    await assert.rejects(
      prisma.planetUnitStack.create({
        data: { planetId: planetIds[0], unitKey: "line-infantry", quantity: 1n },
      }),
    )
    assert.equal(
      await prisma.planetUnitStack.count({ where: { unitKey: "line-infantry" } }),
      baseline.PlanetUnitStack + 2,
    )

    for (let index = 0; index < FACTION_KEYS.length; index += 1) {
      const result = await queryPlanetaryForcesForOwner({
        planetId: planetIds[index],
        ownerId: ownerIds[index],
        factionKey: FACTION_KEYS[index],
        planetModel: prisma.planet,
      })
      assert.equal(result.units.length, 9)
      assert.deepEqual(
        result.units.map(({ key }) => key),
        getPlanetaryRosterForFaction(FACTION_KEYS[index]).map(({ key }) => key),
      )
    }
    const exact = await queryPlanetaryForcesForOwner({
      planetId: planetIds[0],
      ownerId: ownerIds[0],
      factionKey: FACTION_KEYS[0],
      planetModel: prisma.planet,
    })
    assert.equal(exact.units.find(({ key }) => key === "assault-infantry").quantity, "9007199254740993")
    assert.equal(
      await queryPlanetaryForcesForOwner({
        planetId: planetIds[0],
        ownerId: ownerIds[1],
        factionKey: FACTION_KEYS[1],
        planetModel: prisma.planet,
      }),
      null,
    )

    await prisma.planetUnitStack.create({
      data: { planetId: planetIds[1], unitKey: "vanguard-exosuit", quantity: 1n },
    })
    await assert.rejects(
      queryPlanetaryForcesForOwner({
        planetId: planetIds[1],
        ownerId: ownerIds[1],
        factionKey: FACTION_KEYS[1],
        planetModel: prisma.planet,
      }),
      { message: PLANETARY_FORCES_ERROR },
    )

    await resetCivilizationForUser({
      userId: ownerIds[0],
      confirmation: RESET_CIVILIZATION_CONFIRMATION,
      prismaClient: prisma,
    })
    assert.equal(await prisma.planet.count({ where: { ownerId: ownerIds[0] } }), 0)
    assert.equal(
      await prisma.planetUnitStack.count({
        where: { planetId: { in: [planetIds[0], secondOrthevanPlanetId] } },
      }),
      0,
    )
    assert.equal(await prisma.planet.count({ where: { ownerId: ownerIds[1] } }), 1)
    assert.equal(await prisma.planetUnitStack.count({ where: { planetId: planetIds[1] } }), 1)
    assert.equal((await prisma.user.findUnique({ where: { id: ownerIds[0] } })).factionKey, null)
    assert.equal(await prisma.account.count({ where: { id: accountId } }), 1)
    assert.equal(await prisma.session.count({ where: { id: sessionId } }), 1)
    assert.deepEqual(CIVILIZATION_RESET_SCOPE.deleted, [
      "PlanetUnitTransaction",
      "PlanetUnitStack",
      "PlanetMaterialTransaction",
      "Planet",
    ])
    assert.deepEqual(CIVILIZATION_RESET_SCOPE.preserved, [
      "User",
      "Account",
      "Session",
      "Verification",
    ])
  } finally {
    const remainingPlanets = await prisma.planet.findMany({
      where: { ownerId: { in: ownerIds } },
      select: { id: true },
    }).catch(() => [])
    const remainingPlanetIds = remainingPlanets.map(({ id }) => id)
    await prisma.planetUnitTransaction.deleteMany({
      where: { planetId: { in: remainingPlanetIds } },
    }).catch(() => {})
    await prisma.planetUnitStack.deleteMany({
      where: { planetId: { in: remainingPlanetIds } },
    }).catch(() => {})
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: remainingPlanetIds } },
    }).catch(() => {})
    await prisma.planet.deleteMany({ where: { ownerId: { in: ownerIds } } }).catch(() => {})
    await prisma.session.deleteMany({ where: { userId: { in: ownerIds } } }).catch(() => {})
    await prisma.account.deleteMany({ where: { userId: { in: ownerIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } }).catch(() => {})

    if (baseline !== undefined) {
      assert.deepEqual(await rowCounts(prisma), baseline)
    }
    await prisma.$disconnect()
  }
})
