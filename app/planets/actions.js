"use server";

import { redirect } from "next/navigation";

import { ensureAuthenticatedUserStarterPlanet } from "../../lib/owned-planets.js";

export async function establishFirstPlanetAction() {
  await ensureAuthenticatedUserStarterPlanet();
  redirect("/planets");
}
