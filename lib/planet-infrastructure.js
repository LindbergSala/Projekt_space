import {
  getPlanetaryFactionSummary,
  getPlanetaryRosterForFaction,
} from "./planetary-units.js"

export const INFRASTRUCTURE_CANON_ERROR = "Invalid planetary infrastructure."
export const MAXIMUM_INFRASTRUCTURE_LEVEL = 5

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }

  return Object.freeze(value)
}

function definition(
  key,
  name,
  description,
  initialLevel,
  minimumCommandLevel,
  costs,
  seconds,
) {
  return {
    key,
    name,
    description,
    initialLevel,
    maximumLevel: MAXIMUM_INFRASTRUCTURE_LEVEL,
    minimumCommandLevel,
    steps: costs.map((materialsCost, index) => ({
      materialsCost,
      durationSeconds: seconds[index],
      requiredCommandLevel:
        key === "planetary-command"
          ? index
          : Math.max(index + 1, minimumCommandLevel),
    })),
  }
}

const DEFINITIONS = deepFreeze([
  definition(
    "planetary-command",
    "Planetary Command",
    "Unlocks other facilities and sets their maximum completed level.",
    1,
    0,
    [0n, 50n, 100n, 200n, 400n],
    [0, 1_800, 14_400, 86_400, 259_200],
  ),
  definition(
    "materials-extractor",
    "Materials Extractor",
    "Increases passive Materials production from its completion time.",
    0,
    1,
    [10n, 20n, 40n, 80n, 160n],
    [60, 1_800, 14_400, 86_400, 259_200],
  ),
  definition(
    "barracks",
    "Barracks",
    "Unlocks infantry and faction units for future recruitment.",
    0,
    1,
    [20n, 40n, 80n, 160n, 320n],
    [120, 3_600, 21_600, 172_800, 432_000],
  ),
  definition(
    "war-factory",
    "War Factory",
    "Unlocks factory units and reduces the time of future factory production orders.",
    0,
    2,
    [50n, 100n, 200n, 400n, 800n],
    [300, 7_200, 43_200, 259_200, 604_800],
  ),
  definition(
    "space-station",
    "Space Station",
    "Unlocks spacecraft designs for future ship production.",
    0,
    3,
    [100n, 200n, 400n, 800n, 1_600n],
    [600, 14_400, 86_400, 432_000, 1_209_600],
  ),
])

const GENERAL_UNIT_UNLOCKS = deepFreeze({
  barracks: [
    ["line-infantry", 1],
    ["assault-infantry", 2],
    ["heavy-weapons-infantry", 3],
    ["combat-engineer", 4],
  ],
  "war-factory": [
    ["light-tank", 1],
    ["field-artillery", 2],
    ["heavy-tank", 3],
  ],
})

const UNIQUE_UNIT_UNLOCKS = deepFreeze({
  "orthevan-directorate": {
    barracks: ["vanguard-exosuit"],
    "war-factory": ["siege-strider"],
  },
  "zhyreth-brood": {
    barracks: ["razor-beast"],
    "war-factory": ["spore-caster"],
  },
  "nhalorin-continuum": {
    barracks: ["phase-reaper"],
    "war-factory": ["aegis-construct"],
  },
  "draskyr-clans": {
    barracks: ["scrap-brute", "rift-raider"],
    "war-factory": [],
  },
})

const SHIP_UNLOCKS = deepFreeze([
  ["scout-corvette", "Scout Corvette", 1],
  ["cargo-trade-freighter", "Cargo / Trade Freighter", 1],
  ["escort-frigate", "Escort Frigate", 2],
  ["troop-transport", "Troop Transport", 2],
  ["supply-ship", "Supply Ship", 2],
  ["attack-destroyer", "Attack Destroyer", 3],
  ["assault-lander", "Assault Lander", 3],
  ["vehicle-carrier", "Vehicle Carrier", 3],
  ["carrier-ship", "Carrier Ship", 4],
  ["repair-tender", "Repair Tender", 4],
  ["capital-battleship", "Capital Battleship", 5],
].map(([key, name, requiredLevel]) => ({
  kind: "ship", key, name, requiredLevel,
})))

function fail() {
  throw new Error(INFRASTRUCTURE_CANON_ERROR)
}

function validateLevel(level) {
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > MAXIMUM_INFRASTRUCTURE_LEVEL
  ) {
    fail()
  }
}

function validateFaction(factionKey) {
  if (!getPlanetaryFactionSummary(factionKey)) {
    fail()
  }
}

export function getInfrastructureDefinitions() {
  return DEFINITIONS
}

export function getInfrastructureDefinition(key) {
  return DEFINITIONS.find((building) => building.key === key) ?? null
}

// Command level 1 describes the free baseline; it is never a construction order.
export function getInfrastructureStep(key, targetLevel) {
  const building = getInfrastructureDefinition(key)
  validateLevel(targetLevel)
  if (!building || targetLevel === 0) {
    fail()
  }

  return building.steps[targetLevel - 1]
}

export function getInfrastructureUnlocks(buildingKey, factionKey) {
  validateFaction(factionKey)
  if (!getInfrastructureDefinition(buildingKey)) {
    fail()
  }
  if (buildingKey === "space-station") {
    return SHIP_UNLOCKS
  }
  if (buildingKey !== "barracks" && buildingKey !== "war-factory") {
    return Object.freeze([])
  }

  const roster = getPlanetaryRosterForFaction(factionKey)
  const unitLevels = [
    ...GENERAL_UNIT_UNLOCKS[buildingKey],
    ...UNIQUE_UNIT_UNLOCKS[factionKey][buildingKey].map((key) => [key, 5]),
  ]
  return deepFreeze(
    unitLevels.map(([key, requiredLevel]) => {
      const unit = roster.find((entry) => entry.key === key)
      if (!unit) {
        fail()
      }
      return { kind: "unit", key: unit.key, name: unit.name, requiredLevel }
    }),
  )
}

export function getExtractorMaterialsRate(factionKey, level) {
  validateFaction(factionKey)
  validateLevel(level)
  const baseRate = factionKey === "orthevan-directorate" ? 11n : 10n
  return baseRate * BigInt(level + 1)
}

export function getWarFactoryProductionTimePercent(level) {
  validateLevel(level)
  return level === 5 ? 80 : level === 4 ? 90 : 100
}
