import "server-only"

import { requireAuthenticatedUserId } from "./auth-session.js"
import { requireFactionForAuthenticatedUserId } from "./authenticated-faction.js"
import {
  queryOwnedPlanetDetailForOwner,
  queryOwnedPlanets,
} from "./owned-planets-query.js"
import { applyPlanetMaterialsTransactionForOwner } from "./planet-materials-policy.js"
import { claimPlanetMaterialsProductionForOwner } from "./materials-production-claim-policy.js"
import { startPlanetConstructionForOwner } from "./infrastructure-construction-policy.js"
import {
  collectPlanetRecruitmentForOwner,
  startPlanetRecruitmentForOwner,
} from "./planet-recruitment-policy.js"
import { applyPlanetUnitTransactionForOwner } from "./planet-unit-transactions-policy.js"
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

  return queryOwnedPlanetDetailForOwner({
    planetId,
    ownerId,
    prismaClient: prisma,
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

export async function claimAuthenticatedPlanetMaterialsProduction(input) {
  const ownerId = await requireAuthenticatedUserId()
  const { planetId } = input ?? {}

  return claimPlanetMaterialsProductionForOwner({
    ownerId,
    planetId,
    prismaClient: prisma,
  })
}

export async function startAuthenticatedPlanetConstruction(input) {
  const ownerId = await requireAuthenticatedUserId()
  const { planetId, infrastructureEpoch, buildingKey, expectedLevel, operationKey } = input ?? {}

  return startPlanetConstructionForOwner({
    ownerId,
    planetId,
    infrastructureEpoch,
    buildingKey,
    expectedLevel,
    operationKey,
    prismaClient: prisma,
  })
}

export async function applyAuthenticatedPlanetUnitTransaction(input) {
  const ownerId = await requireAuthenticatedUserId()
  const { planetId, unitKey, delta, operationKey } = input ?? {}

  return applyPlanetUnitTransactionForOwner({
    ownerId,
    planetId,
    unitKey,
    delta,
    operationKey,
    prismaClient: prisma,
  })
}

export async function startAuthenticatedPlanetRecruitment(input) {
  const ownerId = await requireAuthenticatedUserId()
  const { planetId, infrastructureEpoch, quantity, operationKey } = input ?? {}

  return startPlanetRecruitmentForOwner({
    ownerId,
    planetId,
    infrastructureEpoch,
    quantity,
    operationKey,
    prismaClient: prisma,
  })
}

export async function collectAuthenticatedPlanetRecruitment(input) {
  const ownerId = await requireAuthenticatedUserId()
  const { planetId, infrastructureEpoch, orderId } = input ?? {}

  return collectPlanetRecruitmentForOwner({
    ownerId,
    planetId,
    infrastructureEpoch,
    orderId,
    prismaClient: prisma,
  })
}
