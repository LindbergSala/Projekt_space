import { PLANETARY_FORCES_ERROR } from "./planetary-forces-error.js"
import {
  calculateMaterialsProduction,
  serializeMaterialsProductionStatus,
} from "./materials-production-policy.js"
import { getPlanetaryRosterForFaction } from "./planetary-units.js"
import { projectPlanetInfrastructure } from "./planet-infrastructure-state.js"

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
  constructionModel,
  currentTime,
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
    const select = {
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
    }

    if (currentTime !== undefined) {
      select.materialsProductionCursor = true
      select.materialsProductionRemainder = true
      select.infrastructureEpoch = true
    }

    planet = await planetModel.findFirst({
      where: {
        id: planetId,
        ownerId,
      },
      select,
    })
  } catch {
    failPlanetaryForcesRead()
  }

  if (planet === null) {
    return null
  }

  const rosterByKey = new Map(roster.map((unit) => [unit.key, unit]))

  try {
    const result = {
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

    if (currentTime !== undefined) {
      // Keep history reads sequential on the transaction's single connection.
      const constructions = await constructionModel.findMany({
        where: { planetId },
        orderBy: { targetLevel: "asc" },
      })
      result.infrastructureEpoch = planet.infrastructureEpoch
      result.infrastructure = projectPlanetInfrastructure({
        constructions,
        factionKey,
        currentTime,
        materials: planet.materials,
      })
      result.production = serializeMaterialsProductionStatus(
        calculateMaterialsProduction({
          factionKey,
          cursor: planet.materialsProductionCursor,
          currentTime,
          remainder: planet.materialsProductionRemainder,
          extractorTransitions: constructions.filter(
            ({ buildingKey }) => buildingKey === "materials-extractor",
          ),
        }),
      )
    }

    return result
  } catch {
    failPlanetaryForcesRead()
  }
}

export async function queryOwnedPlanetDetailForOwner({
  planetId,
  ownerId,
  prismaClient,
}) {
  if (
    !isValidPlanetId(planetId) ||
    typeof ownerId !== "string" ||
    ownerId.length === 0 ||
    ownerId.trim() !== ownerId ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    failPlanetaryForcesRead()
  }

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: ownerId },
        select: { factionKey: true },
      })
      if (!user || getPlanetaryRosterForFaction(user.factionKey) === null) {
        failPlanetaryForcesRead()
      }
      // Read the clock after establishing the snapshot so visible committed
      // transitions cannot appear to start after transaction-start time.
      const timestamps = await transaction.$queryRaw`
        SELECT clock_timestamp() AS "currentTime"
      `

      if (
        timestamps.length !== 1 ||
        !(timestamps[0].currentTime instanceof Date) ||
        Number.isNaN(timestamps[0].currentTime.getTime())
      ) {
        failPlanetaryForcesRead()
      }

      return queryOwnedPlanetById({
        planetId,
        ownerId,
        factionKey: user.factionKey,
        planetModel: transaction.planet,
        constructionModel: transaction.planetConstruction,
        currentTime: timestamps[0].currentTime,
      })
    }, {
      isolationLevel: "RepeatableRead",
    })
  } catch {
    failPlanetaryForcesRead()
  }
}
