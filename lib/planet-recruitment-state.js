import { MAXIMUM_INFRASTRUCTURE_LEVEL } from "./planet-infrastructure.js"
import { getRecruitmentDefinition } from "./unit-production.js"

export const RECRUITMENT_STATE_ERROR = "Unable to read planetary recruitment."
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const MAXIMUM_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
const ORDER_ID = /^recruitment_[a-f0-9]{64}$/

function fail() {
  throw new Error(RECRUITMENT_STATE_ERROR)
}

function timestamp(value) {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime())) fail()
  return BigInt(value.getTime())
}

function positiveQuantity(value) {
  if (typeof value !== "bigint" || value <= 0n || value > POSTGRES_BIGINT_MAXIMUM) fail()
}

function definitionForFaction(factionKey) {
  try {
    return getRecruitmentDefinition(factionKey)
  } catch {
    fail()
  }
}

function secondsFromMilliseconds(milliseconds) {
  const wholeSeconds = milliseconds / 1_000n
  const remainder = milliseconds % 1_000n
  if (remainder === 0n) return wholeSeconds.toString()
  const fraction = remainder.toString().padStart(3, "0").replace(/0+$/, "")
  return `${wholeSeconds}.${fraction}`
}

// Accepted prices and times are history, not a fresh quote from today's registry.
export function serializeRecruitmentOrder({ order, factionKey, currentTime }) {
  const definition = definitionForFaction(factionKey)
  const now = timestamp(currentTime)
  if (
    !order || typeof order.id !== "string" || !ORDER_ID.test(order.id) ||
    order.unitKey !== definition.unitKey
  ) fail()
  positiveQuantity(order.quantity)
  positiveQuantity(order.materialsCost)
  const startedAt = timestamp(order.startedAt)
  const completesAt = timestamp(order.completesAt)
  const collectedAt = order.collectedAt === null ? null : timestamp(order.collectedAt)
  if (
    startedAt > now || completesAt <= startedAt ||
    completesAt - startedAt > MAXIMUM_SAFE_INTEGER ||
    (collectedAt !== null && (collectedAt < completesAt || collectedAt > now))
  ) fail()

  return {
    id: order.id,
    unitKey: definition.unitKey,
    unitName: definition.unitName,
    quantity: order.quantity.toString(),
    materialsCost: order.materialsCost.toString(),
    startedAt: order.startedAt.toISOString(),
    completesAt: order.completesAt.toISOString(),
    collectedAt: order.collectedAt?.toISOString() ?? null,
    status: collectedAt !== null ? "collected" : completesAt <= now ? "ready" : "recruiting",
    durationSeconds: secondsFromMilliseconds(completesAt - startedAt),
  }
}

// Time only changes the projected status. Units enter stacks through Collect.
export function projectPlanetRecruitment({ order, factionKey, currentTime, barracksLevel, materials }) {
  const definition = definitionForFaction(factionKey)
  timestamp(currentTime)
  if (
    !Number.isInteger(barracksLevel) || barracksLevel < 0 ||
    barracksLevel > MAXIMUM_INFRASTRUCTURE_LEVEL || typeof materials !== "bigint" ||
    materials < 0n || materials > POSTGRES_BIGINT_MAXIMUM
  ) fail()
  const savedOrder = order === null ? null : serializeRecruitmentOrder({ order, factionKey, currentTime })
  let blockedReason = null
  if (savedOrder?.status === "recruiting") blockedReason = "A recruitment order is in progress."
  else if (savedOrder?.status === "ready") blockedReason = "Collect the ready order before recruiting again."
  else if (barracksLevel < definition.requiredBuildingLevel) {
    blockedReason = `Requires completed ${definition.requiredBuildingName} level ${definition.requiredBuildingLevel}.`
  } else if (materials < definition.costPerUnit) blockedReason = "Not enough stored Materials."

  return {
    asOf: currentTime.toISOString(),
    unitKey: definition.unitKey,
    unitName: definition.unitName,
    costPerUnit: definition.costPerUnit.toString(),
    durationSecondsPerUnit: definition.durationSecondsPerUnit,
    requiredBuildingKey: definition.requiredBuildingKey,
    requiredBuildingName: definition.requiredBuildingName,
    requiredBuildingLevel: definition.requiredBuildingLevel,
    canRecruit: blockedReason === null,
    blockedReason,
    order: savedOrder,
  }
}
