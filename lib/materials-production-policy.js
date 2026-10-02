import { getExtractorMaterialsRate } from "./planet-infrastructure.js"

export const MATERIALS_PRODUCTION_ERROR =
  "Unable to calculate Materials production."
export const BASE_MATERIALS_PER_HOUR = getExtractorMaterialsRate("zhyreth-brood", 0)
export const ORTHEVAN_MATERIALS_PER_HOUR = getExtractorMaterialsRate(
  "orthevan-directorate", 0,
)
export const MAX_STORED_PRODUCTION_HOURS = 72n

const MILLISECONDS_PER_HOUR = 3_600_000n

function fail() {
  throw new Error(MATERIALS_PRODUCTION_ERROR)
}

function validatedTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail()
  }

  return BigInt(value.getTime())
}

export function getMaterialsProductionRate(factionKey, extractorLevel = 0) {
  try {
    return getExtractorMaterialsRate(factionKey, extractorLevel)
  } catch {
    fail()
  }
}

export function calculateMaterialsProduction({
  factionKey,
  cursor,
  currentTime,
  extractorTransitions = [],
  remainder = 0n,
}) {
  const baseRate = getMaterialsProductionRate(factionKey)
  const cursorMilliseconds = validatedTime(cursor)
  const currentMilliseconds = validatedTime(currentTime)
  const elapsedMilliseconds = currentMilliseconds - cursorMilliseconds

  if (
    elapsedMilliseconds < 0n ||
    !Array.isArray(extractorTransitions) ||
    typeof remainder !== "bigint" ||
    remainder < 0n ||
    remainder >= MILLISECONDS_PER_HOUR
  ) {
    fail()
  }

  let previousLevel = 0
  let previousCompletion = null
  const transitions = extractorTransitions.map((transition) => {
    if (!transition || transition.targetLevel !== previousLevel + 1) {
      fail()
    }
    const milliseconds = validatedTime(transition.completesAt)
    const rate = getMaterialsProductionRate(factionKey, transition.targetLevel)
    if (previousCompletion !== null && milliseconds <= previousCompletion) {
      fail()
    }
    previousLevel = transition.targetLevel
    previousCompletion = milliseconds
    return { milliseconds, rate }
  })

  const completedHours = elapsedMilliseconds / MILLISECONDS_PER_HOUR
  const isCapped = completedHours >= MAX_STORED_PRODUCTION_HOURS
  const claimableHours = isCapped
    ? MAX_STORED_PRODUCTION_HOURS
    : completedHours
  // Storage fills with the first 72 earned hours after the cursor. Later
  // production and partial progress are discarded when a capped claim resets it.
  const productionEnd =
    cursorMilliseconds + claimableHours * MILLISECONDS_PER_HOUR
  let intervalStart = cursorMilliseconds
  let intervalRate = baseRate
  let ratePerHour = baseRate
  let numerator = remainder

  for (const { milliseconds, rate } of transitions) {
    if (milliseconds <= currentMilliseconds) {
      ratePerHour = rate
    }
    if (milliseconds <= cursorMilliseconds) {
      intervalRate = rate
    } else if (milliseconds < productionEnd) {
      numerator += (milliseconds - intervalStart) * intervalRate
      intervalStart = milliseconds
      intervalRate = rate
    }
  }
  numerator += (productionEnd - intervalStart) * intervalRate
  const claimableMaterials = numerator / MILLISECONDS_PER_HOUR
  const nextRemainder = numerator % MILLISECONDS_PER_HOUR
  const nextCursorMilliseconds = isCapped
    ? currentMilliseconds
    : cursorMilliseconds + claimableHours * MILLISECONDS_PER_HOUR
  const nextProductionMilliseconds = isCapped
    ? null
    : cursorMilliseconds + (completedHours + 1n) * MILLISECONDS_PER_HOUR

  return {
    ratePerHour,
    claimableHours,
    claimableMaterials,
    nextRemainder,
    isCapped,
    nextCursor: new Date(Number(nextCursorMilliseconds)),
    nextProductionAt:
      nextProductionMilliseconds === null
        ? null
        : new Date(Number(nextProductionMilliseconds)),
  }
}

export function serializeMaterialsProductionStatus(production) {
  if (
    typeof production?.ratePerHour !== "bigint" ||
    typeof production?.claimableHours !== "bigint" ||
    typeof production?.claimableMaterials !== "bigint" ||
    typeof production?.isCapped !== "boolean" ||
    !(
      production.nextProductionAt === null ||
      (production.nextProductionAt instanceof Date &&
        !Number.isNaN(production.nextProductionAt.getTime()))
    )
  ) {
    fail()
  }

  return {
    ratePerHour: production.ratePerHour.toString(),
    availableMaterials: production.claimableMaterials.toString(),
    claimableHours: production.claimableHours.toString(),
    maximumStoredHours: MAX_STORED_PRODUCTION_HOURS.toString(),
    isCapped: production.isCapped,
    nextProductionAt: production.nextProductionAt?.toISOString() ?? null,
  }
}
