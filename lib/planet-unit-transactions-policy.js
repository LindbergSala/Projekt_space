import { createHash } from "node:crypto"

import { isValidPlanetId } from "./owned-planets-query.js"
import {
  getPlanetaryRosterForFaction,
  getPlanetaryUnits,
} from "./planetary-units.js"

export const PLANET_UNIT_TRANSACTION_ERROR =
  "Unable to apply the planetary unit transaction."
export const PLANET_UNIT_TRANSACTION_CONFLICT_ERROR =
  "The planetary unit transaction conflicts with an existing operation."

const TRANSACTION_ID_DOMAIN =
  "projekt-space/planet-unit-transaction/v1\0"
const MAXIMUM_UNIT_KEY_LENGTH = 32
const MAXIMUM_OPERATION_KEY_LENGTH = 256
const POSTGRES_BIGINT_MINIMUM = -9_223_372_036_854_775_808n
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const GLOBAL_UNIT_KEYS = new Set(getPlanetaryUnits().map(({ key }) => key))

class IdempotencyConflictError extends Error {}

function fail() {
  throw new Error(PLANET_UNIT_TRANSACTION_ERROR)
}

function failConflict() {
  throw new IdempotencyConflictError(
    PLANET_UNIT_TRANSACTION_CONFLICT_ERROR,
  )
}

function isValidOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    ownerId.trim() === ownerId
  )
}

function isValidUnitKey(unitKey) {
  return (
    typeof unitKey === "string" &&
    unitKey.length > 0 &&
    unitKey.length <= MAXIMUM_UNIT_KEY_LENGTH &&
    unitKey.trim() === unitKey &&
    GLOBAL_UNIT_KEYS.has(unitKey)
  )
}

function isValidDelta(delta) {
  return (
    typeof delta === "bigint" &&
    delta !== 0n &&
    delta >= POSTGRES_BIGINT_MINIMUM &&
    delta <= POSTGRES_BIGINT_MAXIMUM
  )
}

function isValidOperationKey(operationKey) {
  return (
    typeof operationKey === "string" &&
    operationKey.length > 0 &&
    operationKey.length <= MAXIMUM_OPERATION_KEY_LENGTH &&
    operationKey.trim() === operationKey
  )
}

export function createPlanetUnitTransactionId(operationKey) {
  if (!isValidOperationKey(operationKey)) {
    fail()
  }

  return createHash("sha256")
    .update(TRANSACTION_ID_DOMAIN, "utf8")
    .update(operationKey, "utf8")
    .digest("hex")
}

function serializedResult({ planetId, unitKey, quantityAfter }) {
  return {
    planetId,
    unitKey,
    quantity: quantityAfter.toString(),
  }
}

export async function applyPlanetUnitTransactionForOwner({
  ownerId,
  planetId,
  unitKey,
  delta,
  operationKey,
  prismaClient,
}) {
  if (
    !isValidOwnerId(ownerId) ||
    !isValidPlanetId(planetId) ||
    !isValidUnitKey(unitKey) ||
    !isValidDelta(delta) ||
    !isValidOperationKey(operationKey) ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    fail()
  }

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw`
        SELECT "factionKey"
          FROM "user"
         WHERE "id" = ${ownerId}
         FOR UPDATE
      `

      if (users.length !== 1) {
        fail()
      }

      const roster = getPlanetaryRosterForFaction(users[0].factionKey)
      if (roster === null || !roster.some((unit) => unit.key === unitKey)) {
        fail()
      }

      const planets = await transaction.$queryRaw`
        SELECT "id"
          FROM "planet"
         WHERE "id" = ${planetId}
           AND "ownerId" = ${ownerId}
         FOR UPDATE
      `

      if (planets.length !== 1) {
        fail()
      }

      const transactionId = createPlanetUnitTransactionId(operationKey)
      const existingTransaction =
        await transaction.planetUnitTransaction.findUnique({
          where: { id: transactionId },
          select: {
            planetId: true,
            unitKey: true,
            delta: true,
            quantityAfter: true,
          },
        })

      if (existingTransaction !== null) {
        if (
          existingTransaction.planetId !== planetId ||
          existingTransaction.unitKey !== unitKey ||
          existingTransaction.delta !== delta
        ) {
          failConflict()
        }

        return serializedResult(existingTransaction)
      }

      const currentStack = await transaction.planetUnitStack.findUnique({
        where: {
          planetId_unitKey: {
            planetId,
            unitKey,
          },
        },
        select: { quantity: true },
      })
      const currentQuantity = currentStack?.quantity ?? 0n
      const nextQuantity = currentQuantity + delta

      if (
        nextQuantity < POSTGRES_BIGINT_MINIMUM ||
        nextQuantity < 0n ||
        nextQuantity > POSTGRES_BIGINT_MAXIMUM
      ) {
        fail()
      }

      await transaction.planetUnitStack.upsert({
        where: {
          planetId_unitKey: {
            planetId,
            unitKey,
          },
        },
        update: { quantity: nextQuantity },
        create: {
          planetId,
          unitKey,
          quantity: nextQuantity,
        },
        select: { quantity: true },
      })

      const unitTransaction =
        await transaction.planetUnitTransaction.create({
          data: {
            id: transactionId,
            planetId,
            unitKey,
            delta,
            quantityAfter: nextQuantity,
          },
          select: {
            planetId: true,
            unitKey: true,
            quantityAfter: true,
          },
        })

      return serializedResult(unitTransaction)
    })
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new Error(PLANET_UNIT_TRANSACTION_CONFLICT_ERROR)
    }

    fail()
  }
}
