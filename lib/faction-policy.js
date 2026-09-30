import { getPlanetaryFactionSummary } from "./planetary-units.js"

export const FACTION_QUERY_ERROR = "Unable to load the faction."
export const FACTION_SELECTION_ERROR = "Unable to select the faction."

function failQuery() {
  throw new Error(FACTION_QUERY_ERROR)
}

function failSelection() {
  throw new Error(FACTION_SELECTION_ERROR)
}

function isValidUserId(userId) {
  return (
    typeof userId === "string" &&
    userId.length > 0 &&
    userId.trim() === userId
  )
}

export function factionSummaryFromStoredKey(factionKey) {
  if (factionKey === null) {
    return null
  }

  const faction = getPlanetaryFactionSummary(factionKey)
  if (faction === null) {
    failQuery()
  }

  return faction
}

export function readStrictFactionSelection(formData) {
  if (typeof formData?.entries !== "function") {
    failSelection()
  }

  const entries = [...formData.entries()]
  if (
    entries.length !== 1 ||
    entries[0][0] !== "factionKey" ||
    typeof entries[0][1] !== "string"
  ) {
    failSelection()
  }

  const faction = getPlanetaryFactionSummary(entries[0][1])
  if (faction === null) {
    failSelection()
  }

  return faction.key
}

export async function queryFactionForUser({ userId, userModel }) {
  if (!isValidUserId(userId) || typeof userModel?.findUnique !== "function") {
    failQuery()
  }

  let user
  try {
    user = await userModel.findUnique({
      where: { id: userId },
      select: { factionKey: true },
    })
  } catch {
    failQuery()
  }

  if (user === null) {
    failQuery()
  }

  return factionSummaryFromStoredKey(user.factionKey)
}

export async function selectFactionForUser({
  userId,
  factionKey,
  prismaClient,
}) {
  const requestedFaction = getPlanetaryFactionSummary(factionKey)
  if (
    !isValidUserId(userId) ||
    requestedFaction === null ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    failSelection()
  }

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw`
        SELECT "factionKey"
          FROM "user"
         WHERE "id" = ${userId}
         FOR UPDATE
      `

      if (users.length !== 1) {
        failSelection()
      }

      const currentFaction = factionSummaryFromStoredKey(users[0].factionKey)
      if (currentFaction !== null) {
        if (currentFaction.key !== requestedFaction.key) {
          failSelection()
        }

        return currentFaction
      }

      const result = await transaction.user.updateMany({
        where: { id: userId, factionKey: null },
        data: { factionKey: requestedFaction.key },
      })

      if (result.count !== 1) {
        failSelection()
      }

      return requestedFaction
    })
  } catch {
    failSelection()
  }
}
