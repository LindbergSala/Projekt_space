import { createHash } from "node:crypto"

import { isValidPlanetId } from "./owned-planets-query.js"

export const PLANET_MATERIALS_TRANSACTION_ERROR =
  "Unable to apply the Materials transaction."

const TRANSACTION_ID_DOMAIN = "projekt-space/material-transaction/v1\0"
const MAXIMUM_OPERATION_KEY_LENGTH = 256
const POSTGRES_BIGINT_MINIMUM = -9_223_372_036_854_775_808n
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n

function fail() {
  throw new Error(PLANET_MATERIALS_TRANSACTION_ERROR)
}

function isValidOwnerId(ownerId) {
  return (
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    ownerId.trim() === ownerId
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

function isValidDelta(delta) {
  return (
    typeof delta === "bigint" &&
    delta !== 0n &&
    delta >= POSTGRES_BIGINT_MINIMUM &&
    delta <= POSTGRES_BIGINT_MAXIMUM
  )
}

export function createPlanetMaterialTransactionId(operationKey) {
  if (!isValidOperationKey(operationKey)) {
    fail()
  }

  const digest = createHash("sha256")
    .update(TRANSACTION_ID_DOMAIN, "utf8")
    .update(operationKey, "utf8")
    .digest("hex")

  return `material_transaction_${digest}`
}

function serializedResult(transaction) {
  return {
    delta: transaction.delta.toString(),
    balanceAfter: transaction.balanceAfter.toString(),
  }
}

export async function applyPlanetMaterialsTransactionForOwner({
  ownerId,
  planetId,
  delta,
  operationKey,
  prismaClient,
}) {
  if (
    !isValidOwnerId(ownerId) ||
    !isValidPlanetId(planetId) ||
    !isValidDelta(delta) ||
    !isValidOperationKey(operationKey) ||
    typeof prismaClient?.$transaction !== "function"
  ) {
    fail()
  }

  const transactionId = createPlanetMaterialTransactionId(operationKey)

  try {
    return await prismaClient.$transaction(async (transaction) => {
      const planets = await transaction.$queryRaw`
        SELECT "id", "materials"
          FROM "planet"
         WHERE "id" = ${planetId}
           AND "ownerId" = ${ownerId}
         FOR UPDATE
      `

      if (planets.length !== 1) {
        fail()
      }

      const existingTransaction =
        await transaction.planetMaterialTransaction.findUnique({
          where: { id: transactionId },
          select: {
            planetId: true,
            delta: true,
            balanceAfter: true,
          },
        })

      if (existingTransaction !== null) {
        if (
          existingTransaction.planetId !== planetId ||
          existingTransaction.delta !== delta
        ) {
          fail()
        }

        return serializedResult(existingTransaction)
      }

      const balanceAfter = planets[0].materials + delta
      if (balanceAfter < 0n || balanceAfter > POSTGRES_BIGINT_MAXIMUM) {
        fail()
      }

      const updateResult = await transaction.planet.updateMany({
        where: {
          id: planetId,
          ownerId,
        },
        data: { materials: balanceAfter },
      })

      if (updateResult.count !== 1) {
        fail()
      }

      const materialTransaction =
        await transaction.planetMaterialTransaction.create({
          data: {
            id: transactionId,
            planetId,
            delta,
            balanceAfter,
          },
          select: {
            delta: true,
            balanceAfter: true,
          },
        })

      return serializedResult(materialTransaction)
    })
  } catch {
    fail()
  }
}
