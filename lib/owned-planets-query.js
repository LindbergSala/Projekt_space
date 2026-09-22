export async function queryOwnedPlanetIds({ ownerId, planetModel }) {
  const planets = await planetModel.findMany({
    where: { ownerId },
    select: { id: true },
    orderBy: { id: "asc" },
  })

  return planets.map(({ id }) => id)
}
