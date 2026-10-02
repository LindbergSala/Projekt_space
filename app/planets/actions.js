"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  claimAuthenticatedPlanetMaterialsProduction,
  collectAuthenticatedPlanetRecruitment,
  ensureAuthenticatedUserStarterPlanet,
  renameAuthenticatedUserPlanet,
  startAuthenticatedPlanetConstruction,
  startAuthenticatedPlanetRecruitment,
} from "../../lib/owned-planets.js";
import { readStrictMaterialsProductionClaim } from "../../lib/materials-production-claim-policy.js";
import {
  CONSTRUCTION_MESSAGES,
  InfrastructureConstructionError,
  readStrictInfrastructureConstruction,
} from "../../lib/infrastructure-construction-policy.js";
import {
  RECRUITMENT_MESSAGES,
  RecruitmentError,
  readStrictRecruitmentCollect,
  readStrictRecruitmentStart,
} from "../../lib/planet-recruitment-policy.js";

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

export async function claimPlanetMaterialsProductionAction(formData) {
  const claim = readStrictMaterialsProductionClaim(formData);
  await claimAuthenticatedPlanetMaterialsProduction(claim);
  const planetPath = `/planets/${encodeURIComponent(claim.planetId)}`;

  revalidatePath("/civilization");
  revalidatePath(planetPath);
  redirect(planetPath);
}

export async function startPlanetConstructionAction(formData) {
  let input;
  let status;

  try {
    input = readStrictInfrastructureConstruction(formData);
    const result = await startAuthenticatedPlanetConstruction(input);
    status = result.replayed ? "replayed" : "started";
  } catch (error) {
    // Authentication redirects and framework control flow must propagate.
    if (!(error instanceof InfrastructureConstructionError)) {
      throw error;
    }

    status = Object.hasOwn(CONSTRUCTION_MESSAGES, error.code)
      ? error.code
      : "unavailable";
  }

  revalidatePath("/civilization");

  if (!input || status === "not-owned" || status === "faction-required") {
    redirect(`/civilization?construction=${status}`);
  }

  const planetPath = `/planets/${encodeURIComponent(input.planetId)}`;
  revalidatePath(planetPath);
  redirect(`${planetPath}?construction=${status}#infrastructure-title`);
}

function finishRecruitmentAction(input, status) {
  revalidatePath("/civilization");

  if (!input || status === "not-owned" || status === "faction-required") {
    redirect(`/civilization?recruitment=${status}`);
  }

  const planetPath = `/planets/${encodeURIComponent(input.planetId)}`;
  revalidatePath(planetPath);
  redirect(`${planetPath}?recruitment=${status}#recruitment-title`);
}

export async function startPlanetRecruitmentAction(formData) {
  let input;
  let status;

  try {
    input = readStrictRecruitmentStart(formData);
    const result = await startAuthenticatedPlanetRecruitment(input);
    status = result.replayed ? "start-replayed" : "started";
  } catch (error) {
    // Authentication redirects and framework control flow must propagate.
    if (!(error instanceof RecruitmentError)) {
      throw error;
    }

    status = Object.hasOwn(RECRUITMENT_MESSAGES, error.code)
      ? error.code
      : "unavailable";
  }

  finishRecruitmentAction(input, status);
}

export async function collectPlanetRecruitmentAction(formData) {
  let input;
  let status;

  try {
    input = readStrictRecruitmentCollect(formData);
    const result = await collectAuthenticatedPlanetRecruitment(input);
    status = result.replayed ? "collect-replayed" : "collected";
  } catch (error) {
    if (!(error instanceof RecruitmentError)) {
      throw error;
    }

    status = Object.hasOwn(RECRUITMENT_MESSAGES, error.code)
      ? error.code
      : "unavailable";
  }

  finishRecruitmentAction(input, status);
}
