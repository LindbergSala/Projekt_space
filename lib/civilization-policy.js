import { factionSummaryFromStoredKey } from "./faction-policy.js"

export const RESET_CIVILIZATION_CONFIRMATION = "RESET CIVILIZATION"
export const CIVILIZATION_RESET_ERROR = "Unable to reset the civilization."

// Current reset boundary: preserve User auth identity, Account, Session, and
// Verification;
// delete PlanetUnitStack and PlanetMaterialTransaction before Planet; then
// clear User.factionKey.
// Every future gameplay-owned model must be added here and to reset tests.
export const CIVILIZATION_RESET_SCOPE = Object.freeze({
  preserved: Object.freeze(["User", "Account", "Session", "Verification"]),
  deleted: Object.freeze([
    "PlanetUnitStack",
    "PlanetMaterialTransaction",
    "Planet",
  ]),
  cleared: "User.factionKey",
})

function fail() {
  throw new Error(CIVILIZATION_RESET_ERROR)
}

function isValidUserId(userId) {
  return (
    typeof userId === "string" &&
    userId.length > 0 &&
    userId.trim() === userId
  )
}

export function readStrictResetConfirmation(formData) {
  if (typeof formData?.entries !== "function") {
    fail()
  }

  const entries = [...formData.entries()]
  if (
    entries.length !== 1 ||
    entries[0][0] !== "confirmation" ||
    entries[0][1] !== RESET_CIVILIZATION_CONFIRMATION
  ) {
    fail()
  }

  return entries[0][1]
}

export async function resetCivilizationForUser({
  userId,
  confirmation,
  prismaClient,
}) {
  if (
    !isValidUserId(userId) ||
    confirmation !== RESET_CIVILIZATION_CONFIRMATION ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    fail()
  }

  try {
    await prismaClient.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw`
        SELECT "factionKey"
          FROM "user"
         WHERE "id" = ${userId}
         FOR UPDATE
      `

      if (users.length !== 1) {
        fail()
      }

      factionSummaryFromStoredKey(users[0].factionKey)

      const planets = await transaction.planet.findMany({
        where: { ownerId: userId },
        select: { id: true },
      })
      const planetIds = planets.map((planet) => planet.id)

      await transaction.planetUnitStack.deleteMany({
        where: { planetId: { in: planetIds } },
      })
      await transaction.planetMaterialTransaction.deleteMany({
        where: { planetId: { in: planetIds } },
      })
      await transaction.planet.deleteMany({
        where: { ownerId: userId },
      })

      const result = await transaction.user.updateMany({
        where: { id: userId },
        data: { factionKey: null },
      })

      if (result.count !== 1) {
        fail()
      }
    })
  } catch {
    fail()
  }
}
