import assert from "node:assert/strict"
import test from "node:test"

import {
  INFRASTRUCTURE_CANON_ERROR,
  getExtractorMaterialsRate,
  getInfrastructureDefinition,
  getInfrastructureDefinitions,
  getInfrastructureStep,
  getInfrastructureUnlocks,
  getWarFactoryProductionTimePercent,
} from "../lib/planet-infrastructure.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
} from "../lib/planetary-units.js"

const EXPECTED = [
  ["planetary-command", "Planetary Command", 1, 0,
    [0n, 50n, 100n, 200n, 400n], [0, 1_800, 14_400, 86_400, 259_200]],
  ["materials-extractor", "Materials Extractor", 0, 1,
    [10n, 20n, 40n, 80n, 160n], [60, 1_800, 14_400, 86_400, 259_200]],
  ["barracks", "Barracks", 0, 1,
    [20n, 40n, 80n, 160n, 320n], [120, 3_600, 21_600, 172_800, 432_000]],
  ["war-factory", "War Factory", 0, 2,
    [50n, 100n, 200n, 400n, 800n], [300, 7_200, 43_200, 259_200, 604_800]],
  ["space-station", "Space Station", 0, 3,
    [100n, 200n, 400n, 800n, 1_600n], [600, 14_400, 86_400, 432_000, 1_209_600]],
]

test("infrastructure canon has exactly five buildings and approved steps", () => {
  assert.deepEqual(getInfrastructureDefinitions().map(({ key }) => key), EXPECTED.map(([key]) => key))
  for (const [key, name, initialLevel, minimumCommandLevel, costs, durations] of EXPECTED) {
    const building = getInfrastructureDefinition(key)
    assert.equal(building.name, name)
    assert.equal(building.initialLevel, initialLevel)
    assert.equal(building.minimumCommandLevel, minimumCommandLevel)
    assert.equal(building.maximumLevel, 5)
    assert.equal(building.steps.length, 5)
    for (let level = 1; level <= 5; level += 1) {
      assert.deepEqual(getInfrastructureStep(key, level), {
        materialsCost: costs[level - 1],
        durationSeconds: durations[level - 1],
        requiredCommandLevel: key === "planetary-command"
          ? level - 1
          : Math.max(level, minimumCommandLevel),
      })
    }
  }
})

test("canon structures cannot be mutated by consumers", () => {
  assert.throws(() => { getInfrastructureDefinitions().push({}) }, TypeError)
  assert.throws(() => { getInfrastructureDefinition("barracks").initialLevel = 5 }, TypeError)
  assert.throws(() => { getInfrastructureStep("barracks", 1).materialsCost = 0n }, TypeError)
  assert.throws(() => { getInfrastructureUnlocks("space-station", "draskyr-clans")[0].name = "Changed" }, TypeError)
})

test("each faction receives exactly its canonical roster across Barracks and War Factory", () => {
  const unique = {
    "orthevan-directorate": [["vanguard-exosuit"], ["siege-strider"]],
    "zhyreth-brood": [["razor-beast"], ["spore-caster"]],
    "nhalorin-continuum": [["phase-reaper"], ["aegis-construct"]],
    "draskyr-clans": [["scrap-brute", "rift-raider"], []],
  }
  for (const { key: factionKey } of getPlanetaryFactionSummaries()) {
    const barracks = getInfrastructureUnlocks("barracks", factionKey)
    const factory = getInfrastructureUnlocks("war-factory", factionKey)
    assert.deepEqual(barracks.map(({ key, requiredLevel }) => [key, requiredLevel]), [
      ["line-infantry", 1], ["assault-infantry", 2],
      ["heavy-weapons-infantry", 3], ["combat-engineer", 4],
      ...unique[factionKey][0].map((key) => [key, 5]),
    ])
    assert.deepEqual(factory.map(({ key, requiredLevel }) => [key, requiredLevel]), [
      ["light-tank", 1], ["field-artillery", 2], ["heavy-tank", 3],
      ...unique[factionKey][1].map((key) => [key, 5]),
    ])
    const unlocked = [...barracks, ...factory]
    assert.equal(unlocked.length, 9)
    const roster = getPlanetaryRosterForFaction(factionKey)
    assert.deepEqual(unlocked.map(({ key }) => key).sort(), roster.map(({ key }) => key).sort())
    for (const unlock of unlocked) {
      assert.equal(unlock.kind, "unit")
      assert.equal(unlock.name, roster.find(({ key }) => key === unlock.key).name)
    }
    assert.deepEqual(getInfrastructureUnlocks("planetary-command", factionKey), [])
    assert.deepEqual(getInfrastructureUnlocks("materials-extractor", factionKey), [])
  }
})

test("station unlocks retain the eleven approved names and exact levels without statistics", () => {
  const expected = [
    ["scout-corvette", "Scout Corvette", 1],
    ["cargo-trade-freighter", "Cargo / Trade Freighter", 1],
    ["escort-frigate", "Escort Frigate", 2], ["troop-transport", "Troop Transport", 2],
    ["supply-ship", "Supply Ship", 2], ["attack-destroyer", "Attack Destroyer", 3],
    ["assault-lander", "Assault Lander", 3], ["vehicle-carrier", "Vehicle Carrier", 3],
    ["carrier-ship", "Carrier Ship", 4], ["repair-tender", "Repair Tender", 4],
    ["capital-battleship", "Capital Battleship", 5],
  ].map(([key, name, requiredLevel]) => ({ kind: "ship", key, name, requiredLevel }))
  for (const { key } of getPlanetaryFactionSummaries()) {
    assert.deepEqual(getInfrastructureUnlocks("space-station", key), expected)
  }
})

test("all Extractor rates and noncumulative factory percentages match the approved rules", () => {
  for (const { key } of getPlanetaryFactionSummaries()) {
    assert.deepEqual(Array.from({ length: 6 }, (_, level) => getExtractorMaterialsRate(key, level)),
      key === "orthevan-directorate" ? [11n, 22n, 33n, 44n, 55n, 66n] : [10n, 20n, 30n, 40n, 50n, 60n])
  }
  assert.deepEqual(Array.from({ length: 6 }, (_, level) => getWarFactoryProductionTimePercent(level)),
    [100, 100, 100, 100, 90, 80])
})

test("unknown keys, factions, and invalid levels fail closed", () => {
  assert.equal(getInfrastructureDefinition("unknown"), null)
  for (const run of [
    () => getInfrastructureStep("unknown", 1),
    () => getInfrastructureStep("planetary-command", 0),
    () => getInfrastructureUnlocks("unknown", "draskyr-clans"),
    () => getInfrastructureUnlocks("barracks", "unknown"),
    () => getInfrastructureUnlocks("space-station", "__proto__"),
    () => getExtractorMaterialsRate("unknown", 0),
    ...[-1, 6, 1.5, "1", 1n, NaN, null, undefined].flatMap((level) => [
      () => getInfrastructureStep("barracks", level),
      () => getExtractorMaterialsRate("draskyr-clans", level),
      () => getWarFactoryProductionTimePercent(level),
    ]),
  ]) {
    assert.throws(run, { message: INFRASTRUCTURE_CANON_ERROR })
  }
})
