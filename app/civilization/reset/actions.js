"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { resetAuthenticatedCivilization } from "../../../lib/authenticated-civilization.js"
import { CIVILIZATION_RESET_ERROR } from "../../../lib/civilization-policy.js"

export async function resetCivilizationAction(formData) {
  let resetFailed = false

  try {
    await resetAuthenticatedCivilization(formData)
  } catch (error) {
    if (error?.message !== CIVILIZATION_RESET_ERROR) {
      throw error
    }
    resetFailed = true
  }

  if (resetFailed) {
    redirect("/civilization/reset?error=confirmation")
  }

  revalidatePath("/account")
  revalidatePath("/faction")
  revalidatePath("/planets")
  redirect("/faction")
}
