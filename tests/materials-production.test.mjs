import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  MATERIALS_PRODUCTION_ERROR,
  calculateMaterialsProduction,
  getMaterialsProductionRate,
  serializeMaterialsProductionStatus,
} from "../lib/materials-production-policy.js"
import { getPlanetaryFactionSummaries } from "../lib/planetary-units.js"
import { queryOwnedPlanetDetailForOwner } from "../lib/owned-planets-query.js"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const HOUR = 3_600_000
const CURSOR = new Date("2026-09-28T00:00:00.000Z")

function production(elapsedMilliseconds, factionKey = "orthevan-directorate") {
  return calculateMaterialsProduction({
    factionKey,
    cursor: CURSOR,
    currentTime: new Date(CURSOR.getTime() + elapsedMilliseconds),
  })
}

test("canonical factions receive the locked Materials rates", () => {
  for (const faction of getPlanetaryFactionSummaries()) {
    assert.equal(
      getMaterialsProductionRate(faction.key),
      faction.key === "orthevan-directorate" ? 11n : 10n,
    )
  }
})

test("only completed hours accrue and sub-hour progress is preserved", () => {
  const beforeHour = production(HOUR - 1)
  assert.deepEqual(beforeHour, {
    ratePerHour: 11n,
    claimableHours: 0n,
    claimableMaterials: 0n,
    isCapped: false,
    nextCursor: CURSOR,
    nextProductionAt: new Date(CURSOR.getTime() + HOUR),
  })

  const partial = production(HOUR + 30 * 60 * 1000)
  assert.equal(partial.claimableHours, 1n)
  assert.equal(partial.claimableMaterials, 11n)
  assert.deepEqual(partial.nextCursor, new Date(CURSOR.getTime() + HOUR))
  assert.deepEqual(
    partial.nextProductionAt,
    new Date(CURSOR.getTime() + 2 * HOUR),
  )
})

test("offline production caps at exactly 72 hours and discards over-cap time", () => {
  const belowCap = production(72 * HOUR - 1)
  assert.equal(belowCap.claimableHours, 71n)
  assert.equal(belowCap.claimableMaterials, 781n)
  assert.equal(belowCap.isCapped, false)

  const atCap = production(72 * HOUR)
  assert.equal(atCap.claimableHours, 72n)
  assert.equal(atCap.claimableMaterials, 792n)
  assert.equal(atCap.isCapped, true)
  assert.deepEqual(atCap.nextCursor, new Date(CURSOR.getTime() + 72 * HOUR))
  assert.equal(atCap.nextProductionAt, null)

  const currentTime = new Date(CURSOR.getTime() + 80.5 * HOUR)
  const overCap = calculateMaterialsProduction({
    factionKey: "orthevan-directorate",
    cursor: CURSOR,
    currentTime,
  })
  assert.equal(overCap.claimableMaterials, 792n)
  assert.equal(overCap.isCapped, true)
  assert.deepEqual(overCap.nextCursor, currentTime)
})

test("production status serializes exact integer values without browser inputs", () => {
  assert.deepEqual(serializeMaterialsProductionStatus(production(3.25 * HOUR)), {
    ratePerHour: "11",
    availableMaterials: "33",
    claimableHours: "3",
    maximumStoredHours: "72",
    isCapped: false,
    nextProductionAt: "2026-09-28T04:00:00.000Z",
  })
})

test("planet detail status uses one database timestamp without writing", async () => {
  const currentTime = new Date("2026-10-01T12:30:00.000Z")
  const cursor = new Date("2026-10-01T10:00:00.000Z")
  let transactionOptions
  let receivedQuery
  const planet = await queryOwnedPlanetDetailForOwner({
    planetId: "planet-owned",
    ownerId: "owner",
    factionKey: "orthevan-directorate",
    prismaClient: {
      async $transaction(run, options) {
        transactionOptions = options
        return run({
          async $queryRaw() {
            return [{ currentTime }]
          },
          planet: {
            async findFirst(query) {
              receivedQuery = query
              return {
                id: "planet-owned",
                name: "Owned",
                materials: 7n,
                materialsProductionCursor: cursor,
                materialTransactions: [],
                unitTransactions: [],
              }
            },
          },
        })
      },
    },
  })

  assert.deepEqual(transactionOptions, { isolationLevel: "RepeatableRead" })
  assert.equal(receivedQuery.select.materialsProductionCursor, true)
  assert.deepEqual(planet.production, {
    ratePerHour: "11",
    availableMaterials: "22",
    claimableHours: "2",
    maximumStoredHours: "72",
    isCapped: false,
    nextProductionAt: "2026-10-01T13:00:00.000Z",
  })
})

test("invalid time, future cursors, and unknown factions fail closed", () => {
  for (const input of [
    { factionKey: "unknown", cursor: CURSOR, currentTime: CURSOR },
    {
      factionKey: "orthevan-directorate",
      cursor: new Date("invalid"),
      currentTime: CURSOR,
    },
    {
      factionKey: "orthevan-directorate",
      cursor: new Date(CURSOR.getTime() + 1),
      currentTime: CURSOR,
    },
  ]) {
    assert.throws(
      () => calculateMaterialsProduction(input),
      { message: MATERIALS_PRODUCTION_ERROR },
    )
  }
})

test("schema and migration add only the production cursor", async () => {
  const schema = await readFile(
    path.join(ROOT_DIRECTORY, "prisma/schema.prisma"),
    "utf8",
  )
  const migration = await readFile(
    path.join(
      ROOT_DIRECTORY,
      "prisma/migrations/20261001155755_add_planet_materials_production/migration.sql",
    ),
    "utf8",
  )

  assert.match(
    schema,
    /materialsProductionCursor\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamp\(3\)/u,
  )
  assert.equal(
    migration.replaceAll("\r\n", "\n").trim(),
    [
      "-- AlterTable",
      'ALTER TABLE "planet"',
      'ADD COLUMN "materialsProductionCursor"',
      "TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
    ].join("\n"),
  )
  assert.doesNotMatch(
    migration,
    /DROP|DELETE|TRUNCATE|CREATE TABLE|ALTER COLUMN|RENAME|materials\s*=|INSERT/iu,
  )
})
