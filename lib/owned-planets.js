import "server-only"

import { requireAuthenticatedUserId } from "./auth-session.js"
import {
  queryOwnedPlanetById,
  queryOwnedPlanetIds,
} from "./owned-planets-query.js"
import prisma from "./prisma.js"
import { ensureStarterPlanetForOwner } from "./starter-planet-policy.js"

export async function getAuthenticatedUserPlanetIds() {
  const ownerId = await requireAuthenticatedUserId()

  return queryOwnedPlanetIds({
    ownerId,
    planetModel: prisma.planet,
  })
}

export async function getAuthenticatedUserPlanetById(planetId) {
  const ownerId = await requireAuthenticatedUserId()

  return queryOwnedPlanetById({
    planetId,
    ownerId,
    planetModel: prisma.planet,
  })
}

export async function ensureAuthenticatedUserStarterPlanet() {
  const ownerId = await requireAuthenticatedUserId()

  return ensureStarterPlanetForOwner({
    ownerId,
    planetModel: prisma.planet,
  })
}
