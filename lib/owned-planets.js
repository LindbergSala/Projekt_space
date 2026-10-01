import "server-only"

import { requireAuthenticatedUserId } from "./auth-session.js"
import { requireFactionForAuthenticatedUserId } from "./authenticated-faction.js"
import {
  queryOwnedPlanetById,
  queryOwnedPlanets,
} from "./owned-planets-query.js"
import { applyPlanetMaterialsTransactionForOwner } from "./planet-materials-policy.js"
import { renamePlanetForOwner } from "./planet-name-policy.js"
import { queryPlanetaryForcesForOwner } from "./planetary-forces-policy.js"
import prisma from "./prisma.js"
import { ensureStarterPlanetForOwner } from "./starter-planet-policy.js"

export async function getAuthenticatedUserPlanets() {
  const ownerId = await requireAuthenticatedUserId()
  await requireFactionForAuthenticatedUserId(ownerId)

  return queryOwnedPlanets({
    ownerId,
    planetModel: prisma.planet,
  })
}

export async function getAuthenticatedUserPlanetById(planetId) {
  const ownerId = await requireAuthenticatedUserId()
  await requireFactionForAuthenticatedUserId(ownerId)

  return queryOwnedPlanetById({
    planetId,
    ownerId,
    planetModel: prisma.planet,
  })
}

export async function getAuthenticatedPlanetaryForces(planetId) {
  const ownerId = await requireAuthenticatedUserId()
  const faction = await requireFactionForAuthenticatedUserId(ownerId)
  const forces = await queryPlanetaryForcesForOwner({
    planetId,
    ownerId,
    factionKey: faction.key,
    planetModel: prisma.planet,
  })

  if (forces === null) {
    return null
  }

  return {
    ...forces,
    faction: {
      key: faction.key,
      name: faction.name,
    },
  }
}

export async function ensureAuthenticatedUserStarterPlanet() {
  const ownerId = await requireAuthenticatedUserId()
  await requireFactionForAuthenticatedUserId(ownerId)

  return ensureStarterPlanetForOwner({
    ownerId,
    prismaClient: prisma,
  })
}

export async function renameAuthenticatedUserPlanet(planetId, planetName) {
  const ownerId = await requireAuthenticatedUserId()
  await requireFactionForAuthenticatedUserId(ownerId)

  return renamePlanetForOwner({
    ownerId,
    planetId,
    planetName,
    planetModel: prisma.planet,
  })
}

export async function applyAuthenticatedPlanetMaterialsTransaction(input) {
  const ownerId = await requireAuthenticatedUserId()
  await requireFactionForAuthenticatedUserId(ownerId)
  const { planetId, delta, operationKey } = input ?? {}

  return applyPlanetMaterialsTransactionForOwner({
    ownerId,
    planetId,
    delta,
    operationKey,
    prismaClient: prisma,
  })
}
