import { isValidPlanetId } from "./owned-planets-query.js"

export const PLANET_NAME_VALIDATION_ERROR =
  "Planet name must be between 3 and 40 characters and contain no control characters."
export const PLANET_RENAME_ERROR = "Unable to rename the planet."

const MINIMUM_PLANET_NAME_LENGTH = 3
const MAXIMUM_PLANET_NAME_LENGTH = 40
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u

export function normalizePlanetName(value) {
  if (typeof value !== "string") {
    throw new Error(PLANET_NAME_VALIDATION_ERROR)
  }

  const name = value.trim()
  const codePointLength = [...name].length

  if (
    codePointLength < MINIMUM_PLANET_NAME_LENGTH ||
    codePointLength > MAXIMUM_PLANET_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(name)
  ) {
    throw new Error(PLANET_NAME_VALIDATION_ERROR)
  }

  return name
}

export async function renamePlanetForOwner({
  ownerId,
  planetId,
  planetName,
  planetModel,
}) {
  if (!isValidPlanetId(planetId)) {
    throw new Error(PLANET_RENAME_ERROR)
  }

  const name = normalizePlanetName(planetName)
  let result

  try {
    result = await planetModel.updateMany({
      where: {
        id: planetId,
        ownerId,
      },
      data: {
        name,
      },
    })
  } catch {
    throw new Error(PLANET_RENAME_ERROR)
  }

  if (result.count !== 1) {
    throw new Error(PLANET_RENAME_ERROR)
  }

  return { id: planetId }
}
