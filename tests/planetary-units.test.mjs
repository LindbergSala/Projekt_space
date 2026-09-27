import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  getGeneralPlanetaryUnits,
  getPlanetaryFaction,
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
  getPlanetaryUnits,
} from "../lib/planetary-units.js"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")

const EXPECTED_GENERAL_KEYS = [
  "line-infantry",
  "assault-infantry",
  "heavy-weapons-infantry",
  "light-tank",
  "heavy-tank",
  "field-artillery",
  "combat-engineer",
]

const EXPECTED_FACTIONS = [
  {
    key: "orthevan-directorate",
    name: "Orthevan Directorate",
    uniqueKeys: ["vanguard-exosuit", "siege-strider"],
    uniqueNames: ["Vanguard Exosuit", "Siege Strider"],
  },
  {
    key: "zhyreth-brood",
    name: "Zhyreth Brood",
    uniqueKeys: ["razor-beast", "spore-caster"],
    uniqueNames: ["Razor Beast", "Spore Caster"],
  },
  {
    key: "nhalorin-continuum",
    name: "Nhalorin Continuum",
    uniqueKeys: ["aegis-construct", "phase-reaper"],
    uniqueNames: ["Aegis Construct", "Phase Reaper"],
  },
  {
    key: "draskyr-clans",
    name: "Draskyr Clans",
    uniqueKeys: ["scrap-brute", "rift-raider"],
    uniqueNames: ["Scrap Brute", "Rift Raider"],
  },
]

function allFieldNames(value, names = new Set()) {
  if (value === null || typeof value !== "object") {
    return names
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    names.add(key)
    allFieldNames(nestedValue, names)
  }

  return names
}

test("registry contains the canonical four factions and fifteen unique definitions", () => {
  const factions = getPlanetaryFactionSummaries()
  const generalUnits = getGeneralPlanetaryUnits()
  const allUnits = getPlanetaryUnits()
  const uniqueUnits = allUnits.filter((unit) => unit.scope === "faction")

  assert.equal(factions.length, 4)
  assert.equal(generalUnits.length, 7)
  assert.equal(uniqueUnits.length, 8)
  assert.equal(allUnits.length, 15)
  assert.deepEqual(
    factions.map((faction) => faction.key),
    EXPECTED_FACTIONS.map((faction) => faction.key),
  )
  assert.deepEqual(
    generalUnits.map((unit) => unit.key),
    EXPECTED_GENERAL_KEYS,
  )

  const factionKeys = factions.map((faction) => faction.key)
  const unitKeys = allUnits.map((unit) => unit.key)
  const unitNames = allUnits.map((unit) => unit.name)
  assert.equal(new Set(factionKeys).size, factionKeys.length)
  assert.equal(new Set(unitKeys).size, unitKeys.length)
  assert.equal(new Set(unitNames).size, unitNames.length)
})

test("every faction roster has seven shared units followed by only its two unique units", () => {
  const allUniqueKeys = EXPECTED_FACTIONS.flatMap((faction) => faction.uniqueKeys)

  for (const expectedFaction of EXPECTED_FACTIONS) {
    const faction = getPlanetaryFaction(expectedFaction.key)
    const roster = getPlanetaryRosterForFaction(expectedFaction.key)

    assert.equal(faction.name, expectedFaction.name)
    assert.equal(roster.length, 9)
    assert.deepEqual(
      roster.slice(0, 7).map((unit) => unit.key),
      EXPECTED_GENERAL_KEYS,
    )
    assert.deepEqual(
      roster.slice(7).map((unit) => unit.key),
      expectedFaction.uniqueKeys,
    )
    assert.deepEqual(
      roster.filter((unit) => unit.scope === "faction").map((unit) => unit.name),
      expectedFaction.uniqueNames,
    )
    assert.deepEqual(
      roster
        .filter((unit) => allUniqueKeys.includes(unit.key))
        .map((unit) => unit.key),
      expectedFaction.uniqueKeys,
    )
  }
})

test("registry values and nested role arrays cannot be mutated through public reads", () => {
  const generalUnits = getGeneralPlanetaryUnits()
  const factions = getPlanetaryFactionSummaries()
  const faction = getPlanetaryFaction("orthevan-directorate")
  const roster = getPlanetaryRosterForFaction("orthevan-directorate")

  for (const value of [generalUnits, factions, faction, roster]) {
    assert.equal(Object.isFrozen(value), true)
  }
  assert.equal(Object.isFrozen(generalUnits[0]), true)
  assert.equal(Object.isFrozen(generalUnits[0].battlefieldRoles), true)
  assert.equal(Object.isFrozen(faction.uniqueUnits), true)
  assert.equal(Object.isFrozen(faction.uniqueUnits[0]), true)

  assert.throws(() => generalUnits.push({}))
  assert.throws(() => {
    generalUnits[0].name = "Changed"
  })
  assert.throws(() => generalUnits[0].battlefieldRoles.push("Changed"))
  assert.throws(() => factions[0].uniqueUnitNames.push("Changed"))
  assert.throws(() => {
    faction.uniqueUnits[0].uniqueRole = "Changed"
  })
  assert.throws(() => roster.pop())
})

test("invalid faction keys return null without normalization or prototype leakage", () => {
  for (const key of [
    undefined,
    null,
    "",
    "ORTHEVAN-DIRECTORATE",
    " orthevan-directorate",
    "orthevan-directorate ",
    "unknown-faction",
    "__proto__",
  ]) {
    assert.equal(getPlanetaryFaction(key), null)
    assert.equal(getPlanetaryRosterForFaction(key), null)
  }
})

test("definitions contain descriptions but no numerical gameplay, ownership, or production fields", () => {
  const units = getPlanetaryUnits()
  const prohibitedFields = new Set([
    "attack",
    "defence",
    "defense",
    "health",
    "speed",
    "cost",
    "costs",
    "productionTime",
    "resourceRequirements",
    "capacity",
    "technologyRequirements",
    "owner",
    "ownerId",
    "ownership",
    "quantity",
    "selectedFaction",
    "databaseId",
    "image",
  ])

  for (const unit of units) {
    assert.equal(typeof unit.key, "string")
    assert.equal(typeof unit.name, "string")
    assert.equal(typeof unit.category, "string")
    assert.equal(typeof unit.primaryFunction, "string")
    assert.ok(unit.battlefieldRoles.length > 0)
    assert.equal(
      unit.scope === "general"
        ? typeof unit.designPrinciple
        : typeof unit.uniqueRole,
      "string",
    )
  }

  for (const field of allFieldNames(units)) {
    assert.equal(prohibitedFields.has(field), false, `prohibited field: ${field}`)
  }
})

test("canonical document summary matches the registry and keeps four Line Infantry presentations", async () => {
  const canon = await readFile(
    path.join(ROOT_DIRECTORY, "PROJECT_SPACE_GROUND_UNITS_CANON.md"),
    "utf8",
  )

  for (const unit of getPlanetaryUnits()) {
    assert.match(canon, new RegExp(`(?:^|\\n)(?:#{1,3} |[-*] )${unit.name}(?:\\n| —)`, "u"))
  }
  for (const faction of EXPECTED_FACTIONS) {
    assert.match(canon, new RegExp(`Gameplay classification:.*${faction.name.split(" ")[0]} visual presentation`, "u"))
  }

  assert.equal(
    (canon.match(/Gameplay classification:.*shared Line Infantry unit; not a separate gameplay definition/gu) ?? []).length,
    4,
  )
  assert.match(canon, /7 shared general unit definitions\./u)
  assert.match(canon, /8 faction-unique unit definitions\./u)
  assert.match(canon, /15 global planetary unit definitions\./u)
  assert.match(canon, /9 available planetary units per faction/u)
  assert.doesNotMatch(canon, /12 total|12\/12|3 per faction/u)
  assert.doesNotMatch(canon, /\| Faction \| Standard Unit \|/u)
})
