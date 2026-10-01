"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { readStrictMaterialsProductionClaim } from "../../lib/materials-production-claim-policy.js"
import { claimAuthenticatedPlanetMaterialsProduction } from "../../lib/owned-planets.js"

export async function claimPlanetMaterialsProductionFromCommandCenterAction(
  formData,
) {
  const claim = readStrictMaterialsProductionClaim(formData)
  await claimAuthenticatedPlanetMaterialsProduction(claim)

  revalidatePath("/civilization")
  revalidatePath(`/planets/${encodeURIComponent(claim.planetId)}`)
  redirect("/civilization")
}
