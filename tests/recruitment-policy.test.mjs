import assert from "node:assert/strict"
import test from "node:test"
import {
  calculateRecruitmentOrder,
  getRecruitmentDefinition,
  getUnitProductionDefinition,
  getUnitProductionDefinitions,
  parseRecruitmentQuantity,
  UNIT_PRODUCTION_ERROR,
} from "../lib/unit-production.js"
import {
  projectPlanetRecruitment,
  RECRUITMENT_STATE_ERROR,
  serializeRecruitmentOrder,
} from "../lib/planet-recruitment-state.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
} from "../lib/planetary-units.js"

const FACTION = "orthevan-directorate"
const NOW = new Date("2026-10-02T12:00:00.123Z")
const BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const DATE_MAXIMUM = 8_640_000_000_000_000n
const RECRUITMENT_TIMESTAMP_MAXIMUM = 253_402_300_799_999n

function order(overrides = {}) {
  return {
    id: `recruitment_${"a".repeat(64)}`,
    planetId: "synthetic-planet",
    unitKey: "line-infantry",
    quantity: 1n,
    materialsCost: 10n,
    startedAt: new Date(NOW.getTime()),
    completesAt: new Date(NOW.getTime() + 300_000),
    collectedAt: null,
    ...overrides,
  }
}

function project(overrides = {}) {
  return projectPlanetRecruitment({
    order: null,
    factionKey: FACTION,
    currentTime: NOW,
    barracksLevel: 1,
    materials: 10n,
    ...overrides,
  })
}

function serialize(savedOrder, currentTime = NOW, factionKey = FACTION) {
  return serializeRecruitmentOrder({ order: savedOrder, factionKey, currentTime })
}

test("the immutable production registry offers only canonical Line Infantry for all four factions", () => {
  const factions = getPlanetaryFactionSummaries()
  assert.equal(factions.length, 4)
  for (const faction of factions) {
    const definitions = getUnitProductionDefinitions(faction.key)
    assert.ok(Object.isFrozen(definitions))
    assert.equal(definitions.length, 1)
    const definition = getRecruitmentDefinition(faction.key)
    const canonicalUnit = getPlanetaryRosterForFaction(faction.key).find(({ key }) => key === "line-infantry")
    assert.ok(Object.isFrozen(definition))
    assert.deepEqual(definition, {
      unitKey: canonicalUnit.key,
      unitName: canonicalUnit.name,
      factionKey: faction.key,
      costPerUnit: 10n,
      durationSecondsPerUnit: 300,
      requiredBuildingKey: "barracks",
      requiredBuildingName: "Barracks",
      requiredBuildingLevel: 1,
    })
    assert.equal(getUnitProductionDefinition("assault-infantry", faction.key), null)
    assert.equal(getUnitProductionDefinition("light-tank", faction.key), null)
    assert.equal(getUnitProductionDefinition("scout-corvette", faction.key), null)
    assert.throws(() => { definition.costPerUnit = 1n }, TypeError)
  }
  for (const invalidFaction of [null, undefined, "", "unknown", "__proto__"]) {
    assert.throws(() => getRecruitmentDefinition(invalidFaction), { message: UNIT_PRODUCTION_ERROR })
  }
})

test("one recruit costs 10 Materials and takes exactly 300 seconds; ten cost 100 and take 3000", () => {
  for (const quantity of [1n, 10n]) {
    const result = calculateRecruitmentOrder({ quantity, currentTime: NOW })
    assert.equal(result.unitKey, "line-infantry")
    assert.equal(result.quantity, quantity)
    assert.equal(result.materialsCost, quantity * 10n)
    assert.equal(result.durationSeconds, quantity * 300n)
    assert.equal(BigInt(result.completesAt.getTime()) - BigInt(result.startedAt.getTime()), quantity * 300_000n)
    assert.equal(result.resultingQuantity, quantity)
    assert.equal(result.startedAt.toISOString(), NOW.toISOString())
    assert.notEqual(result.startedAt, NOW)
  }
})

test("quantity parsing preserves exact canonical positive decimal strings through PostgreSQL BIGINT", () => {
  for (const value of ["1", "10", "9007199254740993", BIGINT_MAXIMUM.toString()]) {
    assert.equal(parseRecruitmentQuantity(value).toString(), value)
  }
  for (const value of [
    "", "0", "00", "01", "-1", "+1", "1.0", "0.1", "1e2", "1E2", " 1", "1 ",
    "1\n", "1\t", "1_000", "0x10", "Infinity", "NaN", "١", "１２", "9".repeat(20),
    (BIGINT_MAXIMUM + 1n).toString(), 1, 1n, null, undefined, {}, new Blob(["1"]),
  ]) {
    assert.throws(() => parseRecruitmentQuantity(value), { message: UNIT_PRODUCTION_ERROR })
  }
})

test("cost and resulting stock overflow are rejected before an order can be accepted", () => {
  const result = calculateRecruitmentOrder({ quantity: 1n, currentTime: NOW, currentQuantity: BIGINT_MAXIMUM - 1n })
  assert.equal(result.resultingQuantity, BIGINT_MAXIMUM)
  const exactLargeStock = calculateRecruitmentOrder({ quantity: 10n, currentTime: NOW, currentQuantity: 9_007_199_254_740_993n })
  assert.equal(exactLargeStock.resultingQuantity, 9_007_199_254_741_003n)
  for (const parameters of [
    { quantity: BIGINT_MAXIMUM / 10n + 1n },
    { quantity: 1n, currentQuantity: BIGINT_MAXIMUM },
    { quantity: 10n, currentQuantity: BIGINT_MAXIMUM - 9n },
    { quantity: BIGINT_MAXIMUM + 1n },
    { quantity: 0n },
    { quantity: -1n },
    { quantity: 1 },
    { quantity: "1" },
    { quantity: 1n, currentQuantity: -1n },
    { quantity: 1n, currentQuantity: BIGINT_MAXIMUM + 1n },
    { quantity: 1n, currentQuantity: 0 },
  ]) {
    assert.throws(() => calculateRecruitmentOrder({ currentTime: NOW, ...parameters }), { message: UNIT_PRODUCTION_ERROR })
  }
})

test("duration and finish timestamp boundaries use integer arithmetic without clipping or rounding", () => {
  const maximumQuantity = (RECRUITMENT_TIMESTAMP_MAXIMUM - BigInt(NOW.getTime())) / 300_000n
  const result = calculateRecruitmentOrder({ quantity: maximumQuantity, currentTime: NOW })
  assert.equal(result.quantity, maximumQuantity)
  assert.equal(BigInt(result.completesAt.getTime()), BigInt(NOW.getTime()) + maximumQuantity * 300_000n)
  assert.equal(result.durationSeconds, maximumQuantity * 300n)
  assert.throws(() => calculateRecruitmentOrder({ quantity: maximumQuantity + 1n, currentTime: NOW }), { message: UNIT_PRODUCTION_ERROR })
  const boundaryStart = new Date(Number(RECRUITMENT_TIMESTAMP_MAXIMUM - 300_000n))
  assert.equal(calculateRecruitmentOrder({ quantity: 1n, currentTime: boundaryStart }).completesAt.toISOString(), "9999-12-31T23:59:59.999Z")
  assert.throws(() => calculateRecruitmentOrder({ quantity: 1n, currentTime: new Date(Number(RECRUITMENT_TIMESTAMP_MAXIMUM - 299_999n)) }), { message: UNIT_PRODUCTION_ERROR })
  assert.throws(() => calculateRecruitmentOrder({ quantity: 1n, currentTime: new Date("+010000-01-01T00:00:00.000Z") }), { message: UNIT_PRODUCTION_ERROR })
  // Even when a negative timestamp could offset a large duration, its millisecond
  // duration must remain independently representable as a safe integer.
  assert.throws(() => calculateRecruitmentOrder({ quantity: 30_023_997_516n, currentTime: new Date(-8_640_000_000_000_000) }), { message: UNIT_PRODUCTION_ERROR })
  for (const currentTime of [new Date(NaN), new Date(Number(DATE_MAXIMUM + 1n)), NOW.toISOString(), null, 0]) {
    assert.throws(() => calculateRecruitmentOrder({ quantity: 1n, currentTime }), { message: UNIT_PRODUCTION_ERROR })
  }
})

test("recruitment requires completed Barracks 1 and enough stored Materials for at least one unit", () => {
  const missingBarracks = project({ barracksLevel: 0, materials: BIGINT_MAXIMUM })
  assert.equal(missingBarracks.canRecruit, false)
  assert.equal(missingBarracks.blockedReason, "Requires completed Barracks level 1.")
  const insufficient = project({ materials: 9n })
  assert.equal(insufficient.canRecruit, false)
  assert.equal(insufficient.blockedReason, "Not enough stored Materials.")
  for (const faction of getPlanetaryFactionSummaries()) {
    for (const barracksLevel of [1, 2, 3, 4, 5]) {
      const result = project({ factionKey: faction.key, barracksLevel })
      assert.equal(result.canRecruit, true)
      assert.equal(result.blockedReason, null)
      assert.equal(result.costPerUnit, "10")
      assert.equal(result.durationSecondsPerUnit, 300)
      assert.equal(result.order, null)
    }
  }
})

test("recruiting changes to ready at exactly the saved completion millisecond", () => {
  const savedOrder = order()
  const justBefore = new Date(savedOrder.completesAt.getTime() - 1)
  assert.equal(serialize(savedOrder, justBefore).status, "recruiting")
  assert.equal(serialize(savedOrder, savedOrder.completesAt).status, "ready")
  assert.equal(serialize(savedOrder, new Date(savedOrder.completesAt.getTime() + 1)).status, "ready")
  assert.equal(serialize(savedOrder, new Date("2030-01-01T00:00:00.000Z")).completesAt, savedOrder.completesAt.toISOString())
})

test("both recruiting and ready orders occupy the recruitment slot until collected", () => {
  const savedOrder = order()
  const recruiting = project({ order: savedOrder })
  assert.equal(recruiting.canRecruit, false)
  assert.equal(recruiting.blockedReason, "A recruitment order is in progress.")
  const ready = project({ order: savedOrder, currentTime: savedOrder.completesAt })
  assert.equal(ready.canRecruit, false)
  assert.equal(ready.blockedReason, "Collect the ready order before recruiting again.")
  const collected = project({
    order: { ...savedOrder, collectedAt: savedOrder.completesAt },
    currentTime: savedOrder.completesAt,
  })
  assert.equal(collected.order.status, "collected")
  assert.equal(collected.canRecruit, true)
})

test("serialization preserves accepted price and duration rather than recomputing from current rules", () => {
  const savedOrder = order({
    quantity: 10n,
    materialsCost: 73n,
    completesAt: new Date(NOW.getTime() + 301_234),
  })
  const result = serialize(savedOrder)
  assert.equal(result.quantity, "10")
  assert.equal(result.materialsCost, "73")
  assert.equal(result.durationSeconds, "301.234")
  assert.equal(result.completesAt, savedOrder.completesAt.toISOString())
  assert.equal(serialize(order({ completesAt: new Date(NOW.getTime() + 301_200) })).durationSeconds, "301.2")
  assert.equal(serialize(order()).durationSeconds, "300")
})

test("persisted BIGINT quantities and prices serialize exactly above Number precision", () => {
  const result = serialize(order({ quantity: 9_007_199_254_740_993n, materialsCost: BIGINT_MAXIMUM }))
  assert.equal(result.quantity, "9007199254740993")
  assert.equal(result.materialsCost, "9223372036854775807")
})

test("projection is read-only and does not put uncollected recruits into existing forces", () => {
  const state = {
    order: order(),
    materials: 25n,
    stack: { unitKey: "line-infantry", quantity: 7n },
    materialsHistory: [{ delta: -10n }],
    unitHistory: [],
  }
  const snapshot = structuredClone(state)
  Object.freeze(state.order)
  Object.freeze(state.stack)
  Object.freeze(state)
  for (const currentTime of [NOW, state.order.completesAt, new Date("2030-01-01T00:00:00.000Z")]) {
    const result = project({ order: state.order, materials: state.materials, currentTime })
    assert.equal(result.order.collectedAt, null)
    assert.equal(Object.hasOwn(result, "forces"), false)
    assert.equal(Object.hasOwn(result, "resultingQuantity"), false)
  }
  assert.deepEqual(state, snapshot)
})

test("invalid persisted recruitment data fails generically", () => {
  for (const overrides of [
    { id: "arbitrary-order" },
    { id: undefined },
    { unitKey: "assault-infantry" },
    { quantity: 0n },
    { quantity: -1n },
    { quantity: BIGINT_MAXIMUM + 1n },
    { quantity: "1" },
    { materialsCost: 0n },
    { materialsCost: BIGINT_MAXIMUM + 1n },
    { startedAt: new Date(NOW.getTime() + 1) },
    { completesAt: NOW },
    { completesAt: new Date(NaN) },
    { startedAt: new Date(-8_640_000_000_000_000), completesAt: new Date(8_640_000_000_000_000) },
    { collectedAt: undefined },
    { collectedAt: NOW },
    { collectedAt: new Date(NOW.getTime() + 300_000) },
  ]) {
    assert.throws(() => serialize(order(overrides)), { message: RECRUITMENT_STATE_ERROR })
  }
  assert.throws(() => serialize(null), { message: RECRUITMENT_STATE_ERROR })
  assert.throws(() => serialize(order(), NOW, "unknown"), { message: RECRUITMENT_STATE_ERROR })
  for (const overrides of [
    { order: undefined }, { barracksLevel: -1 }, { barracksLevel: 6 }, { barracksLevel: 1.5 },
    { barracksLevel: "1" }, { materials: -1n }, { materials: 10 }, { materials: BIGINT_MAXIMUM + 1n },
    { currentTime: new Date(NaN) }, { factionKey: "unknown" },
  ]) {
    assert.throws(() => project(overrides), { message: RECRUITMENT_STATE_ERROR })
  }
})
