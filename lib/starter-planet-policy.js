import { createHash } from "node:crypto"

import { factionSummaryFromStoredKey } from "./faction-policy.js"

const STARTER_PLANET_ID_DOMAIN = "projekt-space/starter-planet/v1\0"
const STARTER_PLANET_OWNERSHIP_ERROR =
  "Unable to establish the starter planet."
const PLANET_ID_SELECTION = { id: true, ownerId: true }

function verifiedPlanetId(planet, ownerId) {
  if (planet?.ownerId !== ownerId) {
    throw new Error(STARTER_PLANET_OWNERSHIP_ERROR)
  }

  return planet.id
}

export function createStarterPlanetId(ownerId) {
  const digest = createHash("sha256")
    .update(STARTER_PLANET_ID_DOMAIN, "utf8")
    .update(ownerId, "utf8")
    .digest("hex")

  return `planet_${digest}`
}

export async function ensureStarterPlanetForOwner({ ownerId, prismaClient }) {
  try {
    return await prismaClient.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw`
        SELECT "factionKey"
          FROM "user"
         WHERE "id" = ${ownerId}
         FOR UPDATE
      `

      if (users.length !== 1) {
        throw new Error(STARTER_PLANET_OWNERSHIP_ERROR)
      }

      const faction = factionSummaryFromStoredKey(users[0].factionKey)
      if (faction === null) {
        throw new Error(STARTER_PLANET_OWNERSHIP_ERROR)
      }

      const existingPlanet = await transaction.planet.findFirst({
        where: { ownerId },
        select: PLANET_ID_SELECTION,
        orderBy: { id: "asc" },
      })

      if (existingPlanet !== null) {
        return verifiedPlanetId(existingPlanet, ownerId)
      }

      const starterPlanetId = createStarterPlanetId(ownerId)
      const starterPlanet = await transaction.planet.upsert({
        where: { id: starterPlanetId },
        update: {},
        create: {
          id: starterPlanetId,
          ownerId,
        },
        select: PLANET_ID_SELECTION,
      })

      return verifiedPlanetId(starterPlanet, ownerId)
    })
  } catch {
    throw new Error(STARTER_PLANET_OWNERSHIP_ERROR)
  }
}
