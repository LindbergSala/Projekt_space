import { getPlanetaryFactionSummary } from "./planetary-units.js"

export const PLAYER_ENTRY_ERROR = "Unable to resolve the player entry."

function failEntry() {
  throw new Error(PLAYER_ENTRY_ERROR)
}

function isValidUserId(userId) {
  return (
    typeof userId === "string" &&
    userId.length > 0 &&
    userId.trim() === userId
  )
}

export function resolvePlayerEntryDestination({
  factionKey,
  hasOwnedPlanet,
}) {
  if (typeof hasOwnedPlanet !== "boolean") {
    failEntry()
  }

  if (factionKey === null) {
    return "/faction"
  }

  if (getPlanetaryFactionSummary(factionKey) === null) {
    failEntry()
  }

  return hasOwnedPlanet ? "/civilization" : "/planets"
}

export async function queryPlayerEntryDestinationForUser({
  userId,
  userModel,
}) {
  if (!isValidUserId(userId) || typeof userModel?.findUnique !== "function") {
    failEntry()
  }

  let user
  try {
    user = await userModel.findUnique({
      where: { id: userId },
      select: {
        factionKey: true,
        ownedPlanets: {
          select: { id: true },
          orderBy: { id: "asc" },
          take: 1,
        },
      },
    })
  } catch {
    failEntry()
  }

  if (user === null || !Array.isArray(user.ownedPlanets)) {
    failEntry()
  }

  return resolvePlayerEntryDestination({
    factionKey: user.factionKey,
    hasOwnedPlanet: user.ownedPlanets.length > 0,
  })
}
