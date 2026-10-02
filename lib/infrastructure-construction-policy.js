import { createHash } from "node:crypto"

import { getInfrastructureDefinition, getInfrastructureStep } from "./planet-infrastructure.js"
import { readInfrastructureState, serializeConstruction } from "./planet-infrastructure-state.js"
import { getPlanetaryFactionSummary } from "./planetary-units.js"

export const CONSTRUCTION_MESSAGES = Object.freeze({
  invalid: "This construction request is invalid. Reload the planet and try again.",
  "not-owned": "This planet is unavailable.",
  "faction-required": "Choose a faction before starting construction.",
  "stale-civilization": "This form belongs to an earlier civilization. Reload the planet.",
  conflict: "This construction request has already been used for another order. Reload the planet.",
  "stale-level": "The building level has changed. Reload the planet before ordering another upgrade.",
  busy: "Another construction is already in progress on this planet.",
  "max-level": "This building has reached its maximum level.",
  "command-required": "Upgrade Planetary Command to the required completed level first.",
  "insufficient-materials": "Not enough stored Materials. Claim production before starting construction.",
  unavailable: "Unable to start construction. Please try again.",
})

export class InfrastructureConstructionError extends Error {
  constructor(code) {
    super(CONSTRUCTION_MESSAGES[code] ?? CONSTRUCTION_MESSAGES.unavailable)
    this.name = "InfrastructureConstructionError"
    this.code = Object.hasOwn(CONSTRUCTION_MESSAGES, code) ? code : "unavailable"
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const FIELDS = ["planetId", "infrastructureEpoch", "buildingKey", "expectedLevel", "operationKey"]
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const OPERATION_DOMAIN = "projekt-space/infrastructure-construction/v1\0"

function fail(code = "unavailable") {
  throw new InfrastructureConstructionError(code)
}

function validId(value, maximum = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value
}

function validIntent({ planetId, infrastructureEpoch, buildingKey, expectedLevel, operationKey }) {
  return validId(planetId) && typeof infrastructureEpoch === "string" && UUID.test(infrastructureEpoch) &&
    getInfrastructureDefinition(buildingKey) !== null && Number.isInteger(expectedLevel) &&
    expectedLevel >= 0 && expectedLevel <= 5 && typeof operationKey === "string" && UUID.test(operationKey)
}

export function readStrictInfrastructureConstruction(formData) {
  if (typeof formData?.entries !== "function") fail("invalid")
  const fields = new Map()
  for (const [name, value] of formData.entries()) {
    if (typeof name !== "string" || typeof value !== "string") fail("invalid")
    // Framework transport metadata cannot contribute any application field.
    if (name.startsWith("$ACTION_")) continue
    if (!FIELDS.includes(name) || fields.has(name)) fail("invalid")
    fields.set(name, value)
  }
  if (fields.size !== FIELDS.length || !/^[0-5]$/u.test(fields.get("expectedLevel"))) fail("invalid")
  const intent = { ...Object.fromEntries(fields), expectedLevel: Number(fields.get("expectedLevel")) }
  if (!validIntent(intent)) fail("invalid")
  return intent
}

function operationId(ownerId, operationKey) {
  return `construction_${createHash("sha256").update(OPERATION_DOMAIN).update(ownerId).update("\0").update(operationKey).digest("hex")}`
}

export async function startPlanetConstructionForOwner({
  ownerId, planetId, infrastructureEpoch, buildingKey, expectedLevel, operationKey, prismaClient,
}) {
  if (!validId(ownerId, 1024) || !validIntent({ planetId, infrastructureEpoch, buildingKey, expectedLevel, operationKey })) {
    fail("invalid")
  }
  if (typeof prismaClient?.$transaction !== "function") fail()

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw`
        SELECT "factionKey" FROM "user" WHERE "id" = ${ownerId} FOR UPDATE
      `
      if (users.length !== 1) fail("not-owned")
      const factionKey = users[0].factionKey
      if (!getPlanetaryFactionSummary(factionKey)) fail("faction-required")

      const planets = await transaction.$queryRaw`
        SELECT "id", "materials", "infrastructureEpoch"
          FROM "planet" WHERE "id" = ${planetId} AND "ownerId" = ${ownerId} FOR UPDATE
      `
      if (planets.length !== 1) fail("not-owned")
      const planet = planets[0]
      if (planet.infrastructureEpoch !== infrastructureEpoch) fail("stale-civilization")
      if (typeof planet.materials !== "bigint" || planet.materials < 0n || planet.materials > POSTGRES_BIGINT_MAXIMUM) fail()

      const timestamps = await transaction.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
      const currentTime = timestamps[0]?.currentTime
      if (timestamps.length !== 1 || !(currentTime instanceof Date) || !Number.isSafeInteger(currentTime.getTime())) fail()

      const id = operationId(ownerId, operationKey)
      const previous = await transaction.planetConstruction.findUnique({ where: { id } })
      if (previous) {
        if (previous.planetId !== planetId || previous.buildingKey !== buildingKey ||
          previous.fromLevel !== expectedLevel || previous.targetLevel !== expectedLevel + 1) fail("conflict")
        return {
          planetId,
          construction: serializeConstruction(previous),
          balanceAfter: planet.materials.toString(),
          replayed: true,
        }
      }

      const constructions = await transaction.planetConstruction.findMany({ where: { planetId } })
      const { levels, activeConstruction } = readInfrastructureState({ constructions, factionKey, currentTime })
      const level = levels[buildingKey]
      if (expectedLevel !== level) fail("stale-level")
      if (level === getInfrastructureDefinition(buildingKey).maximumLevel) fail("max-level")
      if (activeConstruction) fail("busy")
      const targetLevel = level + 1
      const step = getInfrastructureStep(buildingKey, targetLevel)
      if (levels["planetary-command"] < step.requiredCommandLevel) fail("command-required")
      if (planet.materials < step.materialsCost) fail("insufficient-materials")

      const balanceAfter = planet.materials - step.materialsCost
      if (balanceAfter < 0n || balanceAfter > POSTGRES_BIGINT_MAXIMUM) fail()
      const completesAt = new Date(currentTime.getTime() + step.durationSeconds * 1000)
      if (!Number.isSafeInteger(completesAt.getTime())) fail()
      const construction = {
        id, planetId, buildingKey, fromLevel: level, targetLevel,
        startedAt: currentTime, completesAt, materialsCost: step.materialsCost,
      }
      const updated = await transaction.planet.updateMany({
        where: { id: planetId, ownerId, infrastructureEpoch, materials: planet.materials },
        data: { materials: balanceAfter },
      })
      if (updated.count !== 1) fail()
      await transaction.planetConstruction.create({ data: construction, select: { id: true } })
      await transaction.planetMaterialTransaction.create({
        data: {
          id: `materials_${id}`, planetId, delta: -step.materialsCost, balanceAfter, createdAt: currentTime,
        },
        select: { id: true },
      })
      return { planetId, construction: serializeConstruction(construction), balanceAfter: balanceAfter.toString(), replayed: false }
    })
  } catch (error) {
    if (error instanceof InfrastructureConstructionError) throw error
    fail()
  }
}
