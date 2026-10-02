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
    nextRemainder: 0n,
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
          user: {
            async findUnique() {
              return { factionKey: "orthevan-directorate" }
            },
          },
          planetConstruction: {
            async findMany(query) {
              assert.deepEqual(query, {
                where: { planetId: "planet-owned" },
                orderBy: { targetLevel: "asc" },
              })
              return []
            },
          },
          planetRecruitment: {
            async findFirst(query) {
              assert.deepEqual(query, {
                where: { planetId: "planet-owned", collectedAt: null },
              })
              return null
            },
          },
          planet: {
            async findFirst(query) {
              receivedQuery = query
              return {
                id: "planet-owned",
                name: "Owned",
                materials: 7n,
                materialsProductionCursor: cursor,
                materialsProductionRemainder: 0n,
                infrastructureEpoch: "5c436781-e351-4450-a18c-2d1b3a9e6f18",
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
  assert.equal(planet.recruitment.asOf, currentTime.toISOString())
  assert.equal(planet.recruitment.asOf, planet.infrastructure.asOf)
  assert.equal(planet.recruitment.order, null)
  assert.equal(planet.recruitment.canRecruit, false)
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

function at(milliseconds) {
  return new Date(CURSOR.getTime() + milliseconds)
}

function historicalProduction({ elapsed, transitions = [], remainder = 0n, cursor = CURSOR, factionKey = "orthevan-directorate" }) {
  return calculateMaterialsProduction({
    factionKey,
    cursor,
    currentTime: at(elapsed),
    extractorTransitions: transitions,
    remainder,
  })
}

test("a mid-hour upgrade is time weighted without retroactive credit", () => {
  const transitions = [{ targetLevel: 1, completesAt: at(HOUR / 2) }]
  const before = historicalProduction({ elapsed: HOUR / 2 - 1, transitions })
  assert.equal(before.ratePerHour, 11n)
  assert.equal(before.claimableMaterials, 0n)
  const completed = historicalProduction({ elapsed: HOUR / 2, transitions })
  assert.equal(completed.ratePerHour, 22n)
  assert.equal(completed.claimableMaterials, 0n)
  const earned = historicalProduction({ elapsed: HOUR, transitions })
  assert.equal(earned.claimableMaterials, 16n)
  assert.equal(earned.nextRemainder, 1_800_000n)
  assert.deepEqual(earned.nextCursor, at(HOUR))
})

test("transitions on exact boundaries apply to the following interval", () => {
  const atStart = historicalProduction({ elapsed: HOUR, transitions: [{ targetLevel: 1, completesAt: CURSOR }] })
  assert.equal(atStart.claimableMaterials, 22n)
  assert.equal(atStart.nextRemainder, 0n)

  const atEnd = historicalProduction({ elapsed: HOUR, transitions: [{ targetLevel: 1, completesAt: at(HOUR) }] })
  assert.equal(atEnd.claimableMaterials, 11n)
  assert.equal(atEnd.ratePerHour, 22n)
  const afterEnd = historicalProduction({ elapsed: 2 * HOUR, transitions: [{ targetLevel: 1, completesAt: at(HOUR) }] })
  assert.equal(afterEnd.claimableMaterials, 33n)
})

test("multiple transitions retain millisecond precision and saved remainder across segmented claims", () => {
  const transitions = [
    { targetLevel: 1, completesAt: at(123_457) },
    { targetLevel: 2, completesAt: at(HOUR + 1_000_001) },
    { targetLevel: 3, completesAt: at(3 * HOUR + 234_569) },
  ]
  for (const { key: factionKey } of getPlanetaryFactionSummaries()) {
    const combined = historicalProduction({ elapsed: 5 * HOUR + 789, transitions, factionKey, remainder: 17n })
    let total = 0n
    let remainder = 17n
    let cursor = CURSOR
    for (let hour = 1; hour <= 5; hour += 1) {
      const claimed = historicalProduction({ elapsed: hour * HOUR + 789, transitions, factionKey, remainder, cursor })
      total += claimed.claimableMaterials
      remainder = claimed.nextRemainder
      cursor = claimed.nextCursor
      const repeated = historicalProduction({ elapsed: hour * HOUR + 789, transitions, factionKey, remainder, cursor })
      assert.equal(repeated.claimableMaterials, 0n)
      assert.equal(repeated.nextRemainder, remainder)
      assert.deepEqual(repeated.nextCursor, cursor)
    }
    assert.equal(total, combined.claimableMaterials)
    assert.equal(remainder, combined.nextRemainder)
    assert.deepEqual(cursor, combined.nextCursor)
    const base = factionKey === "orthevan-directorate" ? 11n : 10n
    const expectedNumerator = 17n + base * (
      123_457n +
      2n * BigInt(HOUR + 1_000_001 - 123_457) +
      3n * BigInt(3 * HOUR + 234_569 - HOUR - 1_000_001) +
      4n * BigInt(5 * HOUR - 3 * HOUR - 234_569)
    )
    assert.equal(combined.claimableMaterials * BigInt(HOUR) + combined.nextRemainder, expectedNumerator)
  }
})

test("carried fractional Materials eventually become spendable without losing partial-hour time", () => {
  const transitions = [
    { targetLevel: 1, completesAt: at(HOUR / 2) },
    { targetLevel: 2, completesAt: at(1.5 * HOUR) },
  ]
  const first = historicalProduction({ elapsed: 1.25 * HOUR, transitions })
  assert.equal(first.claimableMaterials, 16n)
  assert.equal(first.nextRemainder, 1_800_000n)
  assert.deepEqual(first.nextCursor, at(HOUR))
  const second = historicalProduction({ elapsed: 2.25 * HOUR, transitions, cursor: first.nextCursor, remainder: first.nextRemainder })
  assert.equal(second.claimableMaterials, 28n)
  assert.equal(second.nextRemainder, 0n)
  assert.equal(first.claimableMaterials + second.claimableMaterials,
    historicalProduction({ elapsed: 2.25 * HOUR, transitions }).claimableMaterials)
  assert.deepEqual(second.nextCursor, at(2 * HOUR))
})

test("pre-cursor history sets the starting rate and future history has no early effect", () => {
  const transitions = [
    { targetLevel: 1, completesAt: at(-2 * HOUR) },
    { targetLevel: 2, completesAt: at(-HOUR) },
    { targetLevel: 3, completesAt: at(2 * HOUR) },
  ]
  const now = historicalProduction({ elapsed: HOUR, transitions })
  assert.equal(now.ratePerHour, 33n)
  assert.equal(now.claimableMaterials, 33n)
  assert.equal(now.nextRemainder, 0n)
})

test("capped history credits only the first 72 hours and retains earned fractional Materials", () => {
  const transitions = [
    { targetLevel: 1, completesAt: at(HOUR / 2) },
    { targetLevel: 2, completesAt: at(73 * HOUR) },
    { targetLevel: 3, completesAt: at(100 * HOUR) },
  ]
  const capped = historicalProduction({ elapsed: 80.5 * HOUR, transitions })
  assert.equal(capped.claimableHours, 72n)
  assert.equal(capped.claimableMaterials, 1_578n)
  assert.equal(capped.nextRemainder, 1_800_000n)
  assert.equal(capped.ratePerHour, 33n)
  assert.equal(capped.isCapped, true)
  assert.equal(capped.nextProductionAt, null)
  assert.deepEqual(capped.nextCursor, at(80.5 * HOUR))
  const sameInstant = historicalProduction({ elapsed: 80.5 * HOUR, transitions, cursor: capped.nextCursor, remainder: capped.nextRemainder })
  assert.equal(sameInstant.claimableMaterials, 0n)
  assert.equal(sameInstant.nextRemainder, capped.nextRemainder)
  const nextHour = historicalProduction({ elapsed: 81.5 * HOUR, transitions, cursor: capped.nextCursor, remainder: capped.nextRemainder })
  assert.equal(nextHour.claimableMaterials, 33n)
  assert.equal(nextHour.nextRemainder, capped.nextRemainder)
})

test("a transition immediately before the cap is earned but at or after it is not", () => {
  const beforeCap = historicalProduction({ elapsed: 80 * HOUR, transitions: [{ targetLevel: 1, completesAt: at(72 * HOUR - 1) }] })
  assert.equal(beforeCap.claimableMaterials, 792n)
  assert.equal(beforeCap.nextRemainder, 11n)
  for (const completion of [72 * HOUR, 72 * HOUR + 1, 81 * HOUR]) {
    const capped = historicalProduction({ elapsed: 80 * HOUR, transitions: [{ targetLevel: 1, completesAt: at(completion) }] })
    assert.equal(capped.claimableMaterials, 792n)
    assert.equal(capped.nextRemainder, 0n)
    assert.equal(capped.ratePerHour, completion <= 80 * HOUR ? 22n : 11n)
  }
})

test("invalid remainder and malformed, skipped, duplicate, or unordered history fail closed", () => {
  const valid = { factionKey: "orthevan-directorate", cursor: CURSOR, currentTime: at(HOUR) }
  for (const change of [
    ...[-1n, 3_600_000n, 0, "0", null].map((remainder) => ({ remainder })),
    { extractorTransitions: null },
    { extractorTransitions: [null] },
    { extractorTransitions: [{ targetLevel: 0, completesAt: CURSOR }] },
    { extractorTransitions: [{ targetLevel: 2, completesAt: CURSOR }] },
    { extractorTransitions: [{ targetLevel: "1", completesAt: CURSOR }] },
    { extractorTransitions: [{ targetLevel: 1, completesAt: "2026-09-28T00:00:00Z" }] },
    { extractorTransitions: [{ targetLevel: 1, completesAt: new Date("invalid") }] },
    { extractorTransitions: [{ targetLevel: 1, completesAt: CURSOR }, { targetLevel: 1, completesAt: at(1) }] },
    { extractorTransitions: [{ targetLevel: 1, completesAt: CURSOR }, { targetLevel: 2, completesAt: CURSOR }] },
    { extractorTransitions: [{ targetLevel: 1, completesAt: at(1) }, { targetLevel: 2, completesAt: CURSOR }] },
    { extractorTransitions: Array.from({ length: 6 }, (_, index) => ({ targetLevel: index + 1, completesAt: at(index) })) },
  ]) {
    assert.throws(() => calculateMaterialsProduction({ ...valid, ...change }), { message: MATERIALS_PRODUCTION_ERROR })
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
