import "server-only"

import { redirect } from "next/navigation"

import { requireAuthenticatedUserId } from "./auth-session.js"
import { queryCivilizationCommandCenterForOwner } from "./civilization-overview-query.js"
import {
  readStrictResetConfirmation,
  resetCivilizationForUser,
} from "./civilization-policy.js"
import prisma from "./prisma.js"

export async function getAuthenticatedCivilizationCommandCenter() {
  const ownerId = await requireAuthenticatedUserId()
  const commandCenter = await queryCivilizationCommandCenterForOwner({
    ownerId,
    prismaClient: prisma,
  })

  if (commandCenter === null) {
    redirect("/faction")
  }

  return commandCenter
}

export async function resetAuthenticatedCivilization(formData) {
  const userId = await requireAuthenticatedUserId()
  const confirmation = readStrictResetConfirmation(formData)

  await resetCivilizationForUser({
    userId,
    confirmation,
    prismaClient: prisma,
  })
}
