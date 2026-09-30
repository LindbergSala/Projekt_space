import "server-only"

import { requireAuthenticatedUserId } from "./auth-session.js"
import {
  readStrictResetConfirmation,
  resetCivilizationForUser,
} from "./civilization-policy.js"
import prisma from "./prisma.js"

export async function resetAuthenticatedCivilization(formData) {
  const userId = await requireAuthenticatedUserId()
  const confirmation = readStrictResetConfirmation(formData)

  await resetCivilizationForUser({
    userId,
    confirmation,
    prismaClient: prisma,
  })
}
