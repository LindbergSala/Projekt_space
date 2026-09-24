"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ensureAuthenticatedUserStarterPlanet,
  renameAuthenticatedUserPlanet,
} from "../../lib/owned-planets.js";

export async function establishFirstPlanetAction() {
  await ensureAuthenticatedUserStarterPlanet();
  redirect("/planets");
}

export async function renamePlanetAction(formData) {
  const planetId = formData.get("planetId");
  const planetName = formData.get("planetName");
  const planet = await renameAuthenticatedUserPlanet(planetId, planetName);
  const planetPath = `/planets/${encodeURIComponent(planet.id)}`;

  revalidatePath("/planets");
  revalidatePath(planetPath);
  redirect(planetPath);
}
