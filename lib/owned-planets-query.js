import { PLANETARY_FORCES_ERROR } from "./planetary-forces-error.js"
import { getPlanetaryRosterForFaction } from "./planetary-units.js"

const MAXIMUM_PLANET_ID_LENGTH = 128

function failPlanetaryForcesRead() {
  throw new Error(PLANETARY_FORCES_ERROR)
}

export function isValidPlanetId(planetId) {
  return (
    typeof planetId === "string" &&
    planetId.length > 0 &&
    planetId.length <= MAXIMUM_PLANET_ID_LENGTH &&
    planetId.trim() === planetId
  )
}

export async function queryOwnedPlanets({ ownerId, planetModel }) {
  const planets = await planetModel.findMany({
    where: { ownerId },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  })

  return planets
}

export async function queryOwnedPlanetById({
  planetId,
  ownerId,
  factionKey,
  planetModel,
}) {
  if (!isValidPlanetId(planetId)) {
    return null
  }

  const roster = getPlanetaryRosterForFaction(factionKey)
  if (roster === null) {
    failPlanetaryForcesRead()
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
        name: true,
        materials: true,
        materialTransactions: {
          select: {
            delta: true,
            balanceAfter: true,
            createdAt: true,
          },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 20,
        },
        unitTransactions: {
          select: {
            unitKey: true,
            delta: true,
            quantityAfter: true,
            createdAt: true,
          },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 20,
        },
      },
    })
  } catch {
    failPlanetaryForcesRead()
  }

  if (planet === null) {
    return null
  }

  const rosterByKey = new Map(roster.map((unit) => [unit.key, unit]))

  try {
    return {
      id: planet.id,
      name: planet.name,
      materials: planet.materials.toString(),
      materialHistory: planet.materialTransactions.map((transaction) => ({
        delta: transaction.delta.toString(),
        balanceAfter: transaction.balanceAfter.toString(),
        createdAt: transaction.createdAt.toISOString(),
      })),
      unitHistory: planet.unitTransactions.map((transaction) => {
        const unit = rosterByKey.get(transaction.unitKey)
        if (
          unit === undefined ||
          typeof transaction.delta !== "bigint" ||
          transaction.delta === 0n ||
          typeof transaction.quantityAfter !== "bigint" ||
          transaction.quantityAfter < 0n ||
          !(transaction.createdAt instanceof Date) ||
          Number.isNaN(transaction.createdAt.getTime())
        ) {
          failPlanetaryForcesRead()
        }

        return {
          unitKey: transaction.unitKey,
          unitName: unit.name,
          delta: transaction.delta.toString(),
          quantityAfter: transaction.quantityAfter.toString(),
          createdAt: transaction.createdAt.toISOString(),
        }
      }),
    }
  } catch {
    failPlanetaryForcesRead()
  }
}
