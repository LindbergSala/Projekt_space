import { getPlanetaryFactionSummaries } from "./planetary-units.js"

export const MATERIALS_PRODUCTION_ERROR =
  "Unable to calculate Materials production."
export const BASE_MATERIALS_PER_HOUR = 10n
export const ORTHEVAN_MATERIALS_PER_HOUR = 11n
export const MAX_STORED_PRODUCTION_HOURS = 72n

const MILLISECONDS_PER_HOUR = 3_600_000n
const ORTHEVAN_FACTION_KEY = "orthevan-directorate"
const FACTION_RATES = new Map(
  getPlanetaryFactionSummaries().map(({ key }) => [
    key,
    key === ORTHEVAN_FACTION_KEY
      ? ORTHEVAN_MATERIALS_PER_HOUR
      : BASE_MATERIALS_PER_HOUR,
  ]),
)

function fail() {
  throw new Error(MATERIALS_PRODUCTION_ERROR)
}

function validatedTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail()
  }

  return BigInt(value.getTime())
}

export function getMaterialsProductionRate(factionKey) {
  const rate = FACTION_RATES.get(factionKey)
  if (rate === undefined) {
    fail()
  }

  return rate
}

export function calculateMaterialsProduction({
  factionKey,
  cursor,
  currentTime,
}) {
  const ratePerHour = getMaterialsProductionRate(factionKey)
  const cursorMilliseconds = validatedTime(cursor)
  const currentMilliseconds = validatedTime(currentTime)
  const elapsedMilliseconds = currentMilliseconds - cursorMilliseconds

  if (elapsedMilliseconds < 0n) {
    fail()
  }

  const completedHours = elapsedMilliseconds / MILLISECONDS_PER_HOUR
  const isCapped = completedHours >= MAX_STORED_PRODUCTION_HOURS
  const claimableHours = isCapped
    ? MAX_STORED_PRODUCTION_HOURS
    : completedHours
  const claimableMaterials = claimableHours * ratePerHour
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
