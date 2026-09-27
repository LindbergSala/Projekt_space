import "server-only"

import { requireAuthenticatedUserId } from "./auth-session.js"
import {
  queryOwnedPlanetById,
  queryOwnedPlanets,
} from "./owned-planets-query.js"
import { applyPlanetMaterialsTransactionForOwner } from "./planet-materials-policy.js"
import { renamePlanetForOwner } from "./planet-name-policy.js"
import prisma from "./prisma.js"
import { ensureStarterPlanetForOwner } from "./starter-planet-policy.js"

export async function getAuthenticatedUserPlanets() {
  const ownerId = await requireAuthenticatedUserId()

  return queryOwnedPlanets({
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

export async function renameAuthenticatedUserPlanet(planetId, planetName) {
  const ownerId = await requireAuthenticatedUserId()

  return renamePlanetForOwner({
    ownerId,
    planetId,
    planetName,
    planetModel: prisma.planet,
  })
}

export async function applyAuthenticatedPlanetMaterialsTransaction(input) {
  const ownerId = await requireAuthenticatedUserId()
  const { planetId, delta, operationKey } = input ?? {}

  return applyPlanetMaterialsTransactionForOwner({
    ownerId,
    planetId,
    delta,
    operationKey,
    prismaClient: prisma,
  })
}
