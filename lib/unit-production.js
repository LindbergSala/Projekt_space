import { getInfrastructureDefinition } from "./planet-infrastructure.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
} from "./planetary-units.js"

export const UNIT_PRODUCTION_ERROR = "Invalid unit production."
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const MAXIMUM_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
// Prisma's PostgreSQL adapter cannot round-trip extended ISO years (10000+),
// even though JavaScript Date and PostgreSQL individually support them.
const MAXIMUM_RECRUITMENT_TIMESTAMP = 253_402_300_799_999n

// This first production rule has no faction or War Factory time modifiers.
const LINE_INFANTRY_PRODUCTION = Object.freeze({
  unitKey: "line-infantry",
  costPerUnit: 10n,
  durationSecondsPerUnit: 300,
  requiredBuildingKey: "barracks",
  requiredBuildingLevel: 1,
})

const DEFINITIONS_BY_FACTION = Object.freeze(Object.fromEntries(
  getPlanetaryFactionSummaries().map(({ key: factionKey }) => {
    const unit = getPlanetaryRosterForFaction(factionKey).find(
      ({ key }) => key === LINE_INFANTRY_PRODUCTION.unitKey,
    )
    const building = getInfrastructureDefinition(LINE_INFANTRY_PRODUCTION.requiredBuildingKey)
    return [factionKey, Object.freeze([Object.freeze({
      ...LINE_INFANTRY_PRODUCTION,
      unitName: unit.name,
      factionKey,
      requiredBuildingName: building.name,
    })])]
  }),
))

function fail() {
  throw new Error(UNIT_PRODUCTION_ERROR)
}

export function getUnitProductionDefinitions(factionKey) {
  if (typeof factionKey !== "string" || !Object.hasOwn(DEFINITIONS_BY_FACTION, factionKey)) fail()
  return DEFINITIONS_BY_FACTION[factionKey]
}

export function getUnitProductionDefinition(unitKey, factionKey) {
  return getUnitProductionDefinitions(factionKey).find((entry) => entry.unitKey === unitKey) ?? null
}

export function getRecruitmentDefinition(factionKey) {
  return getUnitProductionDefinition(LINE_INFANTRY_PRODUCTION.unitKey, factionKey)
}

export function parseRecruitmentQuantity(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) fail()
  const quantity = BigInt(value)
  if (quantity > POSTGRES_BIGINT_MAXIMUM) fail()
  return quantity
}

export function calculateRecruitmentOrder({ quantity, currentTime, currentQuantity = 0n }) {
  if (
    typeof quantity !== "bigint" || quantity <= 0n || quantity > POSTGRES_BIGINT_MAXIMUM ||
    typeof currentQuantity !== "bigint" || currentQuantity < 0n ||
    currentQuantity > POSTGRES_BIGINT_MAXIMUM ||
    !(currentTime instanceof Date) || !Number.isSafeInteger(currentTime.getTime())
  ) fail()

  const materialsCost = quantity * LINE_INFANTRY_PRODUCTION.costPerUnit
  const resultingQuantity = currentQuantity + quantity
  const durationSeconds = quantity * BigInt(LINE_INFANTRY_PRODUCTION.durationSecondsPerUnit)
  const durationMilliseconds = durationSeconds * 1_000n
  const completionMilliseconds = BigInt(currentTime.getTime()) + durationMilliseconds
  if (
    materialsCost > POSTGRES_BIGINT_MAXIMUM || resultingQuantity > POSTGRES_BIGINT_MAXIMUM ||
    durationSeconds > MAXIMUM_SAFE_INTEGER || durationMilliseconds > MAXIMUM_SAFE_INTEGER ||
    completionMilliseconds > MAXIMUM_RECRUITMENT_TIMESTAMP
  ) fail()

  return {
    unitKey: LINE_INFANTRY_PRODUCTION.unitKey,
    quantity,
    materialsCost,
    durationSeconds,
    resultingQuantity,
    startedAt: new Date(currentTime.getTime()),
    completesAt: new Date(Number(completionMilliseconds)),
  }
}
