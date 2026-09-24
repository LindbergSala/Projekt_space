const MAXIMUM_PLANET_ID_LENGTH = 128

export function isValidPlanetId(planetId) {
  return (
    typeof planetId === "string" &&
    planetId.length > 0 &&
    planetId.length <= MAXIMUM_PLANET_ID_LENGTH &&
    planetId.trim() === planetId
  )
}

export async function queryOwnedPlanetIds({ ownerId, planetModel }) {
  const planets = await planetModel.findMany({
    where: { ownerId },
    select: { id: true },
    orderBy: { id: "asc" },
  })

  return planets.map(({ id }) => id)
}

export async function queryOwnedPlanetById({
  planetId,
  ownerId,
  planetModel,
}) {
  if (!isValidPlanetId(planetId)) {
    return null
  }

  return planetModel.findFirst({
    where: {
      id: planetId,
      ownerId,
    },
    select: {
      id: true,
    },
  })
}
