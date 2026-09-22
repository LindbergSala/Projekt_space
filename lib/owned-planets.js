import "server-only"

import { requireAuthenticatedUserId } from "./auth-session.js"
import { queryOwnedPlanetIds } from "./owned-planets-query.js"
import prisma from "./prisma.js"

export async function getAuthenticatedUserPlanetIds() {
  const ownerId = await requireAuthenticatedUserId()

  return queryOwnedPlanetIds({
    ownerId,
    planetModel: prisma.planet,
  })
}
