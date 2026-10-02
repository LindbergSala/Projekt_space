import {
  getExtractorMaterialsRate,
  getInfrastructureDefinitions,
  getInfrastructureDefinition,
  getInfrastructureStep,
  getInfrastructureUnlocks,
  getWarFactoryProductionTimePercent,
} from "./planet-infrastructure.js"
import { getPlanetaryFactionSummary } from "./planetary-units.js"

export const INFRASTRUCTURE_STATE_ERROR = "Unable to read planetary infrastructure."
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n

function fail() {
  throw new Error(INFRASTRUCTURE_STATE_ERROR)
}

function timestamp(value) {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime())) fail()
  return value.getTime()
}

export function serializeConstruction(construction) {
  return {
    buildingKey: construction.buildingKey,
    buildingName: getInfrastructureDefinition(construction.buildingKey).name,
    fromLevel: construction.fromLevel,
    targetLevel: construction.targetLevel,
    startedAt: construction.startedAt.toISOString(),
    completesAt: construction.completesAt.toISOString(),
  }
}

// Every row is a paid level transition, including its future effective time.
// No read finalizes a job or advances its economic completion timestamp.
export function readInfrastructureState({ constructions, factionKey, currentTime }) {
  const now = timestamp(currentTime)
  if (!getPlanetaryFactionSummary(factionKey) || !Array.isArray(constructions)) fail()
  const definitions = getInfrastructureDefinitions()
  const maximumTransitions = definitions.reduce(
    (total, definition) => total + definition.maximumLevel - definition.initialLevel,
    0,
  )
  if (constructions.length > maximumTransitions) fail()

  const levels = Object.fromEntries(definitions.map(({ key, initialLevel }) => [key, initialLevel]))
  const plannedLevels = { ...levels }
  const ordered = [...constructions].sort((left, right) => timestamp(left.startedAt) - timestamp(right.startedAt))
  let previousCompletion = null
  let activeConstruction = null

  for (const row of ordered) {
    const definition = getInfrastructureDefinition(row.buildingKey)
    const starts = timestamp(row.startedAt)
    const completes = timestamp(row.completesAt)
    if (
      !definition || !Number.isInteger(row.fromLevel) ||
      !Number.isInteger(row.targetLevel) || row.fromLevel !== plannedLevels[row.buildingKey] ||
      row.targetLevel !== row.fromLevel + 1 || row.targetLevel > definition.maximumLevel ||
      starts > now || (previousCompletion !== null && starts < previousCompletion)
    ) fail()

    const step = getInfrastructureStep(row.buildingKey, row.targetLevel)
    if (
      row.materialsCost !== step.materialsCost || step.materialsCost <= 0n ||
      completes - starts !== step.durationSeconds * 1000 ||
      plannedLevels["planetary-command"] < step.requiredCommandLevel
    ) fail()

    plannedLevels[row.buildingKey] = row.targetLevel
    previousCompletion = completes
    if (completes <= now) {
      levels[row.buildingKey] = row.targetLevel
    } else {
      if (activeConstruction !== null) fail()
      activeConstruction = row
    }
  }

  return { levels, activeConstruction }
}

export function projectPlanetInfrastructure({ constructions, factionKey, currentTime, materials }) {
  if (typeof materials !== "bigint" || materials < 0n || materials > POSTGRES_BIGINT_MAXIMUM) fail()
  const { levels, activeConstruction } = readInfrastructureState({ constructions, factionKey, currentTime })
  return {
    asOf: currentTime.toISOString(),
    buildings: getInfrastructureDefinitions().map((definition) => {
      const level = levels[definition.key]
      const nextLevel = level < definition.maximumLevel ? level + 1 : null
      const step = nextLevel === null ? null : getInfrastructureStep(definition.key, nextLevel)
      let blockedReason = null
      if (step === null) blockedReason = "Maximum level reached."
      else if (activeConstruction) blockedReason = "Another construction is in progress."
      else if (levels["planetary-command"] < step.requiredCommandLevel) {
        blockedReason = `Requires completed Planetary Command level ${step.requiredCommandLevel}.`
      } else if (materials < step.materialsCost) blockedReason = "Not enough stored Materials."

      return {
        key: definition.key,
        name: definition.name,
        level,
        nextLevel,
        cost: step?.materialsCost.toString() ?? null,
        durationSeconds: step?.durationSeconds ?? null,
        requiredCommandLevel: step?.requiredCommandLevel ?? null,
        canBuild: blockedReason === null,
        blockedReason,
        unlocks: getInfrastructureUnlocks(definition.key, factionKey).map((unlock) => ({
          ...unlock, unlocked: unlock.requiredLevel <= level,
        })),
        ...(definition.key === "materials-extractor" ? {
          extractorRatePerHour: getExtractorMaterialsRate(factionKey, level).toString(),
        } : {}),
        ...(definition.key === "war-factory" ? {
          productionTimePercent: getWarFactoryProductionTimePercent(level),
        } : {}),
      }
    }),
    activeConstruction: activeConstruction ? serializeConstruction(activeConstruction) : null,
  }
}
