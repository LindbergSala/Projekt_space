"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { selectAuthenticatedFaction } from "../../lib/authenticated-faction.js"
import { FACTION_SELECTION_ERROR } from "../../lib/faction-policy.js"

export async function selectFactionAction(formData) {
  let selectionFailed = false

  try {
    await selectAuthenticatedFaction(formData)
  } catch (error) {
    if (error?.message !== FACTION_SELECTION_ERROR) {
      throw error
    }
    selectionFailed = true
  }

  if (selectionFailed) {
    redirect("/faction?error=selection")
  }

  revalidatePath("/account")
  revalidatePath("/faction")
  revalidatePath("/planets")
  redirect("/planets")
}
