const MAXIMUM_PLANET_ID_LENGTH = 128

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
  planetModel,
}) {
  if (!isValidPlanetId(planetId)) {
    return null
  }

  const planet = await planetModel.findFirst({
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
    },
  })

  if (planet === null) {
    return null
  }

  return {
    id: planet.id,
    name: planet.name,
    materials: planet.materials.toString(),
    materialHistory: planet.materialTransactions.map((transaction) => ({
      delta: transaction.delta.toString(),
      balanceAfter: transaction.balanceAfter.toString(),
      createdAt: transaction.createdAt.toISOString(),
    })),
  }
}
