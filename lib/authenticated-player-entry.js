import "server-only"

import { getOptionalAuthenticatedUserId } from "./auth-session.js"
import { queryPlayerEntryDestinationForUser } from "./player-entry-policy.js"
import prisma from "./prisma.js"

export async function getAuthenticatedPlayerEntryDestination() {
  const userId = await getOptionalAuthenticatedUserId()

  if (userId === null) {
    return null
  }

  return queryPlayerEntryDestinationForUser({
    userId,
    userModel: prisma.user,
  })
}
