import "server-only"

import { redirect } from "next/navigation"

import { requireAuthenticatedUserId } from "./auth-session.js"
import {
  queryFactionForUser,
  readStrictFactionSelection,
  selectFactionForUser,
} from "./faction-policy.js"
import prisma from "./prisma.js"

export async function getAuthenticatedFaction() {
  const userId = await requireAuthenticatedUserId()

  return queryFactionForUser({ userId, userModel: prisma.user })
}

export async function requireFactionForAuthenticatedUserId(userId) {
  const faction = await queryFactionForUser({
    userId,
    userModel: prisma.user,
  })

  if (faction === null) {
    redirect("/faction")
  }

  return faction
}

export async function requireAuthenticatedFaction() {
  const userId = await requireAuthenticatedUserId()
  return requireFactionForAuthenticatedUserId(userId)
}

export async function selectAuthenticatedFaction(formData) {
  const userId = await requireAuthenticatedUserId()
  const factionKey = readStrictFactionSelection(formData)

  return selectFactionForUser({
    userId,
    factionKey,
    prismaClient: prisma,
  })
}
