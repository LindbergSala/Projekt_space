import { createHash } from "node:crypto"

import { readInfrastructureState } from "./planet-infrastructure-state.js"
import { serializeRecruitmentOrder } from "./planet-recruitment-state.js"
import { applyPlanetUnitTransactionWithLockedPlanet } from "./planet-unit-transactions-policy.js"
import { getPlanetaryFactionSummary } from "./planetary-units.js"
import {
  calculateRecruitmentOrder,
  getRecruitmentDefinition,
  parseRecruitmentQuantity,
} from "./unit-production.js"

export const RECRUITMENT_MESSAGES = Object.freeze({
  invalid: "This recruitment request is invalid. Reload the planet and try again.",
  "not-owned": "This planet or recruitment order is unavailable.",
  "faction-required": "Choose a faction before recruiting units.",
  "stale-civilization": "This form belongs to an earlier civilization. Reload the planet.",
  conflict: "This recruitment request has already been used for another order. Reload the planet.",
  "barracks-required": "Complete Barracks level 1 before recruiting Line Infantry.",
  busy: "Collect the existing recruitment order before starting another one.",
  "insufficient-materials": "Not enough stored Materials. Claim production before recruiting.",
  capacity: "This order exceeds the supported quantity, balance, or time limit.",
  "not-ready": "These recruits are not ready yet. Refresh status after their completion time.",
  unavailable: "Unable to process recruitment. Please try again.",
})

export class RecruitmentError extends Error {
  constructor(code) {
    super(RECRUITMENT_MESSAGES[code] ?? RECRUITMENT_MESSAGES.unavailable)
    this.name = "RecruitmentError"
    this.code = Object.hasOwn(RECRUITMENT_MESSAGES, code) ? code : "unavailable"
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const ORDER_ID = /^recruitment_[a-f0-9]{64}$/u
const START_FIELDS = ["planetId", "infrastructureEpoch", "quantity", "operationKey"]
const COLLECT_FIELDS = ["planetId", "infrastructureEpoch", "orderId"]
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const OPERATION_DOMAIN = "projekt-space/planet-recruitment/v1\0"
const DELIVERY_DOMAIN = "projekt-space/planet-recruitment-delivery/v1\0"

function fail(code = "unavailable") {
  throw new RecruitmentError(code)
}

function validId(value, maximum = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value
}

function validPlanetIntent({ planetId, infrastructureEpoch }) {
  return validId(planetId) && typeof infrastructureEpoch === "string" && UUID.test(infrastructureEpoch)
}

function startQuantity(input) {
  if (!validPlanetIntent(input) || typeof input.operationKey !== "string" || !UUID.test(input.operationKey)) fail("invalid")
  try {
    return parseRecruitmentQuantity(input.quantity)
  } catch {
    fail("invalid")
  }
}

function validateCollect(input) {
  if (!validPlanetIntent(input) || typeof input.orderId !== "string" || !ORDER_ID.test(input.orderId)) fail("invalid")
}

function readFields(formData, allowed) {
  if (typeof formData?.entries !== "function") fail("invalid")
  const fields = new Map()
  for (const [name, value] of formData.entries()) {
    if (typeof name !== "string" || typeof value !== "string") fail("invalid")
    // Reserved transport metadata never supplies an application intent field.
    if (name.startsWith("$ACTION_")) continue
    if (!allowed.includes(name) || fields.has(name)) fail("invalid")
    fields.set(name, value)
  }
  if (fields.size !== allowed.length) fail("invalid")
  return Object.fromEntries(fields)
}

export function readStrictRecruitmentStart(formData) {
  const intent = readFields(formData, START_FIELDS)
  startQuantity(intent)
  return intent
}

export function readStrictRecruitmentCollect(formData) {
  const intent = readFields(formData, COLLECT_FIELDS)
  validateCollect(intent)
  return intent
}

function operationId(ownerId, operationKey) {
  return `recruitment_${createHash("sha256").update(OPERATION_DOMAIN).update(ownerId).update("\0").update(operationKey).digest("hex")}`
}

async function lockOwnedPlanet({ transaction, ownerId, planetId, infrastructureEpoch }) {
  const users = await transaction.$queryRaw`
    SELECT "factionKey" FROM "user" WHERE "id" = ${ownerId} FOR UPDATE
  `
  if (users.length !== 1) fail("not-owned")
  const planets = await transaction.$queryRaw`
    SELECT "id", "materials", "infrastructureEpoch"
      FROM "planet" WHERE "id" = ${planetId} AND "ownerId" = ${ownerId} FOR UPDATE
  `
  if (planets.length !== 1) fail("not-owned")
  const factionKey = users[0].factionKey
  if (!getPlanetaryFactionSummary(factionKey)) fail("faction-required")
  const planet = planets[0]
  if (planet.infrastructureEpoch !== infrastructureEpoch) fail("stale-civilization")
  if (typeof planet.materials !== "bigint" || planet.materials < 0n || planet.materials > POSTGRES_BIGINT_MAXIMUM) fail()
  return { planet, factionKey }
}

async function databaseTime(transaction) {
  const timestamps = await transaction.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
  const currentTime = timestamps[0]?.currentTime
  if (timestamps.length !== 1 || !(currentTime instanceof Date) || !Number.isSafeInteger(currentTime.getTime())) fail()
  return currentTime
}

async function currentUnitQuantity(transaction, planetId, unitKey) {
  const stack = await transaction.planetUnitStack.findUnique({
    where: { planetId_unitKey: { planetId, unitKey } },
    select: { quantity: true },
  })
  const quantity = stack?.quantity ?? 0n
  if (typeof quantity !== "bigint" || quantity < 0n || quantity > POSTGRES_BIGINT_MAXIMUM) fail()
  return quantity
}

export async function startPlanetRecruitmentForOwner({
  ownerId, planetId, infrastructureEpoch, quantity, operationKey, prismaClient,
}) {
  const parsedQuantity = startQuantity({ planetId, infrastructureEpoch, quantity, operationKey })
  if (!validId(ownerId, 1024)) fail("invalid")
  if (typeof prismaClient?.$transaction !== "function") fail()
  try {
    return await prismaClient.$transaction(async (transaction) => {
      const { planet, factionKey } = await lockOwnedPlanet({ transaction, ownerId, planetId, infrastructureEpoch })
      const definition = getRecruitmentDefinition(factionKey)
      const id = operationId(ownerId, operationKey)
      const previous = await transaction.planetRecruitment.findUnique({ where: { id } })
      if (previous && (previous.planetId !== planetId || previous.unitKey !== definition.unitKey || previous.quantity !== parsedQuantity)) fail("conflict")
      const currentTime = await databaseTime(transaction)
      if (previous) {
        return {
          planetId, order: serializeRecruitmentOrder({ order: previous, factionKey, currentTime }),
          balanceAfter: planet.materials.toString(), replayed: true,
        }
      }

      const constructions = await transaction.planetConstruction.findMany({ where: { planetId } })
      const { levels } = readInfrastructureState({ constructions, factionKey, currentTime })
      if (levels[definition.requiredBuildingKey] < definition.requiredBuildingLevel) fail("barracks-required")
      const pending = await transaction.planetRecruitment.findFirst({ where: { planetId, collectedAt: null }, select: { id: true } })
      if (pending) fail("busy")
      const currentQuantity = await currentUnitQuantity(transaction, planetId, definition.unitKey)
      let calculation
      try {
        calculation = calculateRecruitmentOrder({ quantity: parsedQuantity, currentTime, currentQuantity })
      } catch {
        fail("capacity")
      }
      if (planet.materials < calculation.materialsCost) fail("insufficient-materials")
      const balanceAfter = planet.materials - calculation.materialsCost
      const order = {
        id, planetId, unitKey: definition.unitKey, quantity: parsedQuantity,
        materialsCost: calculation.materialsCost, startedAt: calculation.startedAt,
        completesAt: calculation.completesAt, collectedAt: null,
      }
      const updated = await transaction.planet.updateMany({
        where: { id: planetId, ownerId, infrastructureEpoch, materials: planet.materials },
        data: { materials: balanceAfter },
      })
      if (updated.count !== 1) fail()
      await transaction.planetRecruitment.create({ data: order, select: { id: true } })
      await transaction.planetMaterialTransaction.create({
        data: { id: `materials_${id}`, planetId, delta: -order.materialsCost, balanceAfter, createdAt: currentTime },
        select: { id: true },
      })
      return {
        planetId, order: serializeRecruitmentOrder({ order, factionKey, currentTime }),
        balanceAfter: balanceAfter.toString(), replayed: false,
      }
    })
  } catch (error) {
    if (error instanceof RecruitmentError) throw error
    fail()
  }
}

export async function collectPlanetRecruitmentForOwner({
  ownerId, planetId, infrastructureEpoch, orderId, prismaClient,
}) {
  validateCollect({ planetId, infrastructureEpoch, orderId })
  if (!validId(ownerId, 1024)) fail("invalid")
  if (typeof prismaClient?.$transaction !== "function") fail()
  try {
    return await prismaClient.$transaction(async (transaction) => {
      const { factionKey } = await lockOwnedPlanet({ transaction, ownerId, planetId, infrastructureEpoch })
      const order = await transaction.planetRecruitment.findFirst({ where: { id: orderId, planetId } })
      if (!order) fail("not-owned")
      const currentTime = await databaseTime(transaction)
      const serialized = serializeRecruitmentOrder({ order, factionKey, currentTime })
      if (order.collectedAt !== null) return { planetId, order: serialized, replayed: true }
      if (currentTime.getTime() < order.completesAt.getTime()) fail("not-ready")
      const currentQuantity = await currentUnitQuantity(transaction, planetId, order.unitKey)
      if (currentQuantity + order.quantity > POSTGRES_BIGINT_MAXIMUM) fail("capacity")

      await applyPlanetUnitTransactionWithLockedPlanet({
        transaction, planetId, factionKey, unitKey: order.unitKey, delta: order.quantity,
        operationKey: `${DELIVERY_DOMAIN}${order.id}`, createdAt: currentTime,
      })
      const updated = await transaction.planetRecruitment.updateMany({
        where: { id: orderId, planetId, collectedAt: null }, data: { collectedAt: currentTime },
      })
      if (updated.count !== 1) fail()
      return {
        planetId, order: serializeRecruitmentOrder({ order: { ...order, collectedAt: currentTime }, factionKey, currentTime }),
        replayed: false,
      }
    })
  } catch (error) {
    if (error instanceof RecruitmentError) throw error
    fail()
  }
}
