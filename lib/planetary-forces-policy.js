import { isValidPlanetId } from "./owned-planets-query.js"
import { getPlanetaryRosterForFaction } from "./planetary-units.js"

export const PLANETARY_FORCES_ERROR = "Unable to read planetary forces."

function fail() {
  throw new Error(PLANETARY_FORCES_ERROR)
}

function isValidOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    ownerId.trim() === ownerId
  )
}

export async function queryPlanetaryForcesForOwner({
  planetId,
  ownerId,
  factionKey,
  planetModel,
}) {
  if (!isValidPlanetId(planetId)) {
    return null
  }

  const roster = getPlanetaryRosterForFaction(factionKey)
  if (
    !isValidOwnerId(ownerId) ||
    roster === null ||
    typeof planetModel?.findFirst !== "function"
  ) {
    fail()
  }

  let planet
  try {
    planet = await planetModel.findFirst({
      where: {
        id: planetId,
        ownerId,
      },
      select: {
        id: true,
        unitStacks: {
          select: {
            unitKey: true,
            quantity: true,
          },
        },
      },
    })
  } catch {
    fail()
  }

  if (planet === null) {
    return null
  }

  if (planet.id !== planetId || !Array.isArray(planet.unitStacks)) {
    fail()
  }

  const allowedKeys = new Set(roster.map((unit) => unit.key))
  const quantities = new Map()

  for (const stack of planet.unitStacks) {
    if (
      !allowedKeys.has(stack.unitKey) ||
      typeof stack.quantity !== "bigint" ||
      stack.quantity < 0n ||
      quantities.has(stack.unitKey)
    ) {
      fail()
    }

    quantities.set(stack.unitKey, stack.quantity.toString())
  }

  return {
    id: planet.id,
    units: roster.map(({ key, name, category }) => ({
      key,
      name,
      category,
      quantity: quantities.get(key) ?? "0",
    })),
  }
}
