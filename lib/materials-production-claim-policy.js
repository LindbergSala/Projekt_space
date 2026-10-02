import { createHash } from "node:crypto"

import {
  calculateMaterialsProduction,
  getMaterialsProductionRate,
  serializeMaterialsProductionStatus,
} from "./materials-production-policy.js"
import { isValidPlanetId } from "./owned-planets-query.js"

export const MATERIALS_PRODUCTION_CLAIM_ERROR =
  "Unable to claim Materials production."

const TRANSACTION_ID_DOMAIN =
  "projekt-space/materials-production-claim/v1\0"
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n

function fail() {
  throw new Error(MATERIALS_PRODUCTION_CLAIM_ERROR)
}

function isValidOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    ownerId.trim() === ownerId
  )
}

function createProductionTransactionId({
  planetId,
  originalCursor,
  nextCursor,
  claimableMaterials,
}) {
  return `material_production_${createHash("sha256")
    .update(TRANSACTION_ID_DOMAIN, "utf8")
    .update(planetId, "utf8")
    .update("\0", "utf8")
    .update(originalCursor.toISOString(), "utf8")
    .update("\0", "utf8")
    .update(nextCursor.toISOString(), "utf8")
    .update("\0", "utf8")
    .update(claimableMaterials.toString(), "utf8")
    .digest("hex")}`
}

export function readStrictMaterialsProductionClaim(formData) {
  if (typeof formData?.entries !== "function") {
    fail()
  }

  const entries = []
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") {
      fail()
    }
    // React action metadata is transport data, never gameplay authority.
    if (!name.startsWith("$ACTION_")) {
      entries.push([name, value])
    }
  }
  if (
    entries.length !== 1 ||
    entries[0][0] !== "planetId" ||
    !isValidPlanetId(entries[0][1])
  ) {
    fail()
  }

  return { planetId: entries[0][1] }
}

export async function claimPlanetMaterialsProductionForOwner({
  ownerId,
  planetId,
  prismaClient,
}) {
  if (
    !isValidOwnerId(ownerId) ||
    !isValidPlanetId(planetId) ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    fail()
  }

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw`
        SELECT "factionKey"
          FROM "user"
         WHERE "id" = ${ownerId}
         FOR UPDATE
      `

      if (users.length !== 1) {
        fail()
      }

      const factionKey = users[0].factionKey
      getMaterialsProductionRate(factionKey)

      const planets = await transaction.$queryRaw`
        SELECT "id", "materials", "materialsProductionCursor"
          FROM "planet"
         WHERE "id" = ${planetId}
           AND "ownerId" = ${ownerId}
         FOR UPDATE
      `

      if (
        planets.length !== 1 ||
        typeof planets[0].materials !== "bigint" ||
        planets[0].materials < 0n ||
        !(planets[0].materialsProductionCursor instanceof Date) ||
        Number.isNaN(planets[0].materialsProductionCursor.getTime())
      ) {
        fail()
      }

      const timestamps = await transaction.$queryRaw`
        SELECT clock_timestamp() AS "currentTime"
      `
      if (
        timestamps.length !== 1 ||
        !(timestamps[0].currentTime instanceof Date) ||
        Number.isNaN(timestamps[0].currentTime.getTime())
      ) {
        fail()
      }

      const planet = planets[0]
      const currentTime = timestamps[0].currentTime
      const production = calculateMaterialsProduction({
        factionKey,
        cursor: planet.materialsProductionCursor,
        currentTime,
      })

      if (production.claimableMaterials === 0n) {
        return {
          planetId,
          claimedMaterials: "0",
          balanceAfter: planet.materials.toString(),
          production: serializeMaterialsProductionStatus(production),
        }
      }

      const balanceAfter = planet.materials + production.claimableMaterials
      if (balanceAfter > POSTGRES_BIGINT_MAXIMUM) {
        fail()
      }

      const transactionId = createProductionTransactionId({
        planetId,
        originalCursor: planet.materialsProductionCursor,
        nextCursor: production.nextCursor,
        claimableMaterials: production.claimableMaterials,
      })
      const updateResult = await transaction.planet.updateMany({
        where: {
          id: planetId,
          ownerId,
          materialsProductionCursor: planet.materialsProductionCursor,
        },
        data: {
          materials: balanceAfter,
          materialsProductionCursor: production.nextCursor,
        },
      })

      if (updateResult.count !== 1) {
        fail()
      }

      await transaction.planetMaterialTransaction.create({
        data: {
          id: transactionId,
          planetId,
          delta: production.claimableMaterials,
          balanceAfter,
          createdAt: currentTime,
        },
        select: { id: true },
      })

      return {
        planetId,
        claimedMaterials: production.claimableMaterials.toString(),
        balanceAfter: balanceAfter.toString(),
        production: serializeMaterialsProductionStatus(
          calculateMaterialsProduction({
            factionKey,
            cursor: production.nextCursor,
            currentTime,
          }),
        ),
      }
    })
  } catch {
    fail()
  }
}
