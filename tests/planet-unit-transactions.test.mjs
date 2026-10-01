import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  RESET_CIVILIZATION_CONFIRMATION,
  resetCivilizationForUser,
} from "../lib/civilization-policy.js"
import { queryOwnedPlanetById } from "../lib/owned-planets-query.js"
import {
  PLANET_UNIT_TRANSACTION_CONFLICT_ERROR,
  PLANET_UNIT_TRANSACTION_ERROR,
  applyPlanetUnitTransactionForOwner,
  createPlanetUnitTransactionId,
} from "../lib/planet-unit-transactions-policy.js"
import { PLANETARY_FORCES_ERROR } from "../lib/planetary-forces-policy.js"
import {
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
  getPlanetaryUnits,
} from "../lib/planetary-units.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const BIGINT_MAXIMUM = 9_223_372_036_854_775_807n
const FACTION_KEYS = getPlanetaryFactionSummaries().map(({ key }) => key)
const TABLE_DELEGATES = [
  ["User", "user"],
  ["Account", "account"],
  ["Session", "session"],
  ["Verification", "verification"],
  ["Planet", "planet"],
  ["PlanetMaterialTransaction", "planetMaterialTransaction"],
  ["PlanetUnitStack", "planetUnitStack"],
  ["PlanetUnitTransaction", "planetUnitTransaction"],
]

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function localPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
}

async function rowCounts(prisma) {
  return Object.fromEntries(
    await Promise.all(
      TABLE_DELEGATES.map(async ([label, delegate]) => [
        label,
        await prisma[delegate].count(),
      ]),
    ),
  )
}

async function withSyntheticCivilizations(run) {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const ownerIds = FACTION_KEYS.map((_, index) => `unit-tx-owner-${index}-${testId}`)
  const planetIds = FACTION_KEYS.map((_, index) => `unit-tx-planet-${index}-${testId}`)
  const secondOrthevanPlanetId = `unit-tx-planet-second-${testId}`
  const allPlanetIds = [...planetIds, secondOrthevanPlanetId]
  let baseline

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])
    baseline = await rowCounts(prisma)

    await prisma.user.createMany({
      data: ownerIds.map((id, index) => ({
        id,
        name: "Planetary unit transaction probe",
        email: `${id}@example.invalid`,
        factionKey: FACTION_KEYS[index],
      })),
    })
    await prisma.planet.createMany({
      data: [
        ...planetIds.map((id, index) => ({ id, ownerId: ownerIds[index] })),
        { id: secondOrthevanPlanetId, ownerId: ownerIds[0] },
      ],
    })

    await run({
      prisma,
      testId,
      ownerIds,
      planetIds,
      secondOrthevanPlanetId,
    })
  } finally {
    await prisma.planetUnitTransaction.deleteMany({
      where: { planetId: { in: allPlanetIds } },
    }).catch(() => {})
    await prisma.planetUnitStack.deleteMany({
      where: { planetId: { in: allPlanetIds } },
    }).catch(() => {})
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: allPlanetIds } },
    }).catch(() => {})
    await prisma.planet.deleteMany({
      where: { id: { in: allPlanetIds } },
    }).catch(() => {})
    await prisma.session.deleteMany({
      where: { userId: { in: ownerIds } },
    }).catch(() => {})
    await prisma.account.deleteMany({
      where: { userId: { in: ownerIds } },
    }).catch(() => {})
    await prisma.user.deleteMany({
      where: { id: { in: ownerIds } },
    }).catch(() => {})

    if (baseline !== undefined) {
      assert.deepEqual(await rowCounts(prisma), baseline)
    }
    await prisma.$disconnect()
  }
}

test("schema and migration create only the immutable constrained unit ledger", async () => {
  const schema = await source("prisma/schema.prisma")
  const directories = await readdir(path.join(ROOT_DIRECTORY, "prisma/migrations"), {
    withFileTypes: true,
  })
  const migrationDirectory = directories.find(
    (entry) =>
      entry.isDirectory() &&
      entry.name.endsWith("_add_planet_unit_transactions"),
  )

  assert.match(schema, /unitTransactions\s+PlanetUnitTransaction\[\]/u)
  assert.match(schema, /model PlanetUnitTransaction \{/u)
  assert.match(schema, /id\s+String\s+@id/u)
  assert.match(schema, /unitKey\s+String\s+@db\.VarChar\(32\)/u)
  assert.match(schema, /delta\s+BigInt\s+@db\.BigInt/u)
  assert.match(schema, /quantityAfter\s+BigInt\s+@db\.BigInt/u)
  assert.match(schema, /createdAt\s+DateTime\s+@default\(now\(\)\)/u)
  assert.match(
    schema,
    /@@index\(\[planetId, createdAt, id\], map: "planet_unit_history_idx"\)/u,
  )
  assert.match(schema, /@@map\("planet_unit_transaction"\)/u)
  assert.ok(migrationDirectory)

  const migration = await source(
    `prisma/migrations/${migrationDirectory.name}/migration.sql`,
  )
  assert.equal((migration.match(/CREATE TABLE/gu) ?? []).length, 1)
  assert.match(migration, /CREATE TABLE "planet_unit_transaction"/u)
  const tableBody = migration.match(
    /CREATE TABLE "planet_unit_transaction" \(([\s\S]*?)\n\);/u,
  )?.[1]
  assert.ok(tableBody)
  assert.deepEqual(
    [...tableBody.matchAll(/^\s+"([^"]+)"\s/gmu)].map((match) => match[1]),
    ["id", "planetId", "unitKey", "delta", "quantityAfter", "createdAt"],
  )
  assert.match(migration, /planet_unit_transaction_pkey" PRIMARY KEY \("id"\)/u)
  assert.match(migration, /planet_unit_transaction_delta_nonzero" CHECK \("delta" <> 0\)/u)
  assert.match(
    migration,
    /planet_unit_transaction_quantity_nonnegative" CHECK \("quantityAfter" >= 0\)/u,
  )
  assert.match(migration, /planet_unit_transaction_unitKey_valid" CHECK/u)
  assert.match(
    migration,
    /CREATE INDEX "planet_unit_history_idx" ON "planet_unit_transaction"\("planetId", "createdAt", "id"\)/u,
  )
  assert.match(
    migration,
    /REFERENCES "planet"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/u,
  )
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT|UPDATE|DELETE|CREATE TRIGGER|CREATE FUNCTION|GRANT)\b/imu,
  )
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(?:user|account|session|verification|planet|planet_material_transaction|planet_unit_stack)"/u,
  )
  assert.deepEqual(
    [...migration.matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    getPlanetaryUnits().map(({ key }) => key),
  )
})

test("operation ID, validation, lock order, and server boundary are fixed", async () => {
  const policy = await source("lib/planet-unit-transactions-policy.js")
  const operation = await source("lib/owned-planets.js")
  const appFiles = await readdir(path.join(ROOT_DIRECTORY, "app"), {
    recursive: true,
    withFileTypes: true,
  })
  const operationKey = "trusted-unit-operation"
  const expectedId = createHash("sha256")
    .update("projekt-space/planet-unit-transaction/v1\0", "utf8")
    .update(operationKey, "utf8")
    .digest("hex")

  assert.equal(createPlanetUnitTransactionId(operationKey), expectedId)
  assert.match(expectedId, /^[a-f0-9]{64}$/u)
  assert.equal(expectedId.includes(operationKey), false)
  assert.match(
    policy,
    /TRANSACTION_ID_DOMAIN =\s*"projekt-space\/planet-unit-transaction\/v1\\0"/u,
  )
  assert.doesNotMatch(policy, /Number\(/u)
  assert.doesNotMatch(
    policy,
    /planetUnitTransaction\.create\(\{[\s\S]*?data:\s*\{[^}]*operationKey/u,
  )
  assert.doesNotMatch(
    policy,
    /planetUnitTransaction\.(?:update|updateMany|delete|deleteMany)/u,
  )

  const mutation = policy.slice(
    policy.indexOf("export async function applyPlanetUnitTransactionForOwner"),
  )
  const orderedMarkers = [
    'SELECT "factionKey"',
    'SELECT "id"',
    "createPlanetUnitTransactionId(operationKey)",
    "planetUnitTransaction.findUnique",
    "planetUnitStack.findUnique",
    "planetUnitStack.upsert",
    "planetUnitTransaction.create",
  ]
  let previousIndex = -1
  for (const marker of orderedMarkers) {
    const markerIndex = mutation.indexOf(marker)
    assert.ok(markerIndex > previousIndex, `${marker} must preserve lock/write order`)
    previousIndex = markerIndex
  }
  assert.match(mutation, /WHERE "id" = \$\{ownerId\}[\s\S]*FOR UPDATE/u)
  assert.match(
    mutation,
    /WHERE "id" = \$\{planetId\}[\s\S]*AND "ownerId" = \$\{ownerId\}[\s\S]*FOR UPDATE/u,
  )

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    operation,
    /export async function applyAuthenticatedPlanetUnitTransaction\(input\)/u,
  )
  assert.match(operation, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.match(
    operation,
    /const \{ planetId, unitKey, delta, operationKey \} = input \?\? \{\}/u,
  )
  assert.doesNotMatch(operation, /const \{[^}]*ownerId|const \{[^}]*factionKey/u)

  for (const entry of appFiles) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue
    }
    const appSource = await readFile(
      path.join(entry.parentPath, entry.name),
      "utf8",
    )
    assert.doesNotMatch(appSource, /applyAuthenticatedPlanetUnitTransaction/u)
  }

  let transactionCount = 0
  const prismaClient = {
    async $transaction() {
      transactionCount += 1
    },
  }
  const valid = {
    ownerId: "authenticated-owner",
    planetId: "planet-owned",
    unitKey: "line-infantry",
    delta: 1n,
    operationKey: "operation-key",
    prismaClient,
  }
  const invalidInputs = [
    { planetId: " padded " },
    { planetId: "x".repeat(129) },
    { unitKey: " padded " },
    { unitKey: "x".repeat(33) },
    { unitKey: "unknown-unit" },
    { delta: 0n },
    { delta: 1 },
    { delta: BIGINT_MAXIMUM + 1n },
    { delta: -BIGINT_MAXIMUM - 2n },
    { operationKey: " padded " },
    { operationKey: "x".repeat(257) },
  ]
  for (const override of invalidInputs) {
    await assert.rejects(
      applyPlanetUnitTransactionForOwner({ ...valid, ...override }),
      { message: PLANET_UNIT_TRANSACTION_ERROR },
    )
  }
  assert.equal(transactionCount, 0)
})

test("database constraints and the atomic operation enforce precision and isolation", async () => {
  await withSyntheticCivilizations(async ({
    prisma,
    testId,
    ownerIds,
    planetIds,
    secondOrthevanPlanetId,
  }) => {
    const invalidBase = {
      planetId: planetIds[0],
      unitKey: "line-infantry",
      delta: 1n,
      quantityAfter: 1n,
    }
    for (const data of [
      { ...invalidBase, id: `zero-${testId}`, delta: 0n },
      { ...invalidBase, id: `negative-${testId}`, quantityAfter: -1n },
      { ...invalidBase, id: `key-${testId}`, unitKey: "invalid-unit" },
      { ...invalidBase, id: `planet-${testId}`, planetId: `missing-${testId}` },
    ]) {
      await assert.rejects(prisma.planetUnitTransaction.create({ data }))
    }
    await prisma.planetUnitTransaction.create({
      data: { ...invalidBase, id: `duplicate-${testId}` },
    })
    await assert.rejects(
      prisma.planetUnitTransaction.create({
        data: { ...invalidBase, id: `duplicate-${testId}` },
      }),
    )
    await prisma.planetUnitTransaction.delete({
      where: { id: `duplicate-${testId}` },
    })

    const largeDelta = 9_007_199_254_740_993n
    const operationKey = `large-${testId}`
    const expected = {
      planetId: planetIds[0],
      unitKey: "line-infantry",
      quantity: "9007199254740993",
    }
    assert.deepEqual(
      await applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[0],
        planetId: planetIds[0],
        unitKey: "line-infantry",
        delta: largeDelta,
        operationKey,
        prismaClient: prisma,
      }),
      expected,
    )
    assert.deepEqual(
      await applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[0],
        planetId: planetIds[0],
        unitKey: "line-infantry",
        delta: largeDelta,
        operationKey,
        prismaClient: prisma,
      }),
      expected,
    )
    assert.equal(
      await prisma.planetUnitTransaction.count({
        where: { id: createPlanetUnitTransactionId(operationKey) },
      }),
      1,
    )
    assert.deepEqual(
      await prisma.planetUnitStack.findUnique({
        where: {
          planetId_unitKey: {
            planetId: planetIds[0],
            unitKey: "line-infantry",
          },
        },
        select: { quantity: true },
      }),
      { quantity: largeDelta },
    )

    for (const conflict of [
      { planetId: secondOrthevanPlanetId },
      { unitKey: "assault-infantry" },
      { delta: largeDelta - 1n },
    ]) {
      await assert.rejects(
        applyPlanetUnitTransactionForOwner({
          ownerId: ownerIds[0],
          planetId: planetIds[0],
          unitKey: "line-infantry",
          delta: largeDelta,
          operationKey,
          prismaClient: prisma,
          ...conflict,
        }),
        { message: PLANET_UNIT_TRANSACTION_CONFLICT_ERROR },
      )
    }
    assert.equal(
      await prisma.planetUnitTransaction.count({
        where: { id: createPlanetUnitTransactionId(operationKey) },
      }),
      1,
    )

    let missingMessage
    await assert.rejects(
      applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[0],
        planetId: `missing-${testId}`,
        unitKey: "line-infantry",
        delta: 1n,
        operationKey: `missing-${testId}`,
        prismaClient: prisma,
      }),
      (error) => {
        missingMessage = error.message
        return true
      },
    )
    let foreignMessage
    await assert.rejects(
      applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[0],
        planetId: planetIds[1],
        unitKey: "line-infantry",
        delta: 1n,
        operationKey: `foreign-${testId}`,
        prismaClient: prisma,
      }),
      (error) => {
        foreignMessage = error.message
        return true
      },
    )
    assert.equal(missingMessage, PLANET_UNIT_TRANSACTION_ERROR)
    assert.equal(foreignMessage, missingMessage)

    await assert.rejects(
      applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[1],
        planetId: planetIds[1],
        unitKey: "vanguard-exosuit",
        delta: 1n,
        operationKey: `wrong-faction-${testId}`,
        prismaClient: prisma,
      }),
      { message: PLANET_UNIT_TRANSACTION_ERROR },
    )

    for (let index = 0; index < FACTION_KEYS.length; index += 1) {
      const uniqueUnits = getPlanetaryRosterForFaction(FACTION_KEYS[index]).slice(7)
      for (const unit of uniqueUnits) {
        assert.deepEqual(
          await applyPlanetUnitTransactionForOwner({
            ownerId: ownerIds[index],
            planetId: planetIds[index],
            unitKey: unit.key,
            delta: 1n,
            operationKey: `unique-${index}-${unit.key}-${testId}`,
            prismaClient: prisma,
          }),
          { planetId: planetIds[index], unitKey: unit.key, quantity: "1" },
        )
      }
    }

    const countBeforeCrossFactionChecks =
      await prisma.planetUnitTransaction.count()
    for (let sourceIndex = 0; sourceIndex < FACTION_KEYS.length; sourceIndex += 1) {
      const uniqueUnits = getPlanetaryRosterForFaction(
        FACTION_KEYS[sourceIndex],
      ).slice(7)
      for (let targetIndex = 0; targetIndex < FACTION_KEYS.length; targetIndex += 1) {
        if (targetIndex === sourceIndex) {
          continue
        }
        for (const unit of uniqueUnits) {
          await assert.rejects(
            applyPlanetUnitTransactionForOwner({
              ownerId: ownerIds[targetIndex],
              planetId: planetIds[targetIndex],
              unitKey: unit.key,
              delta: 1n,
              operationKey:
                `cross-faction-${sourceIndex}-${targetIndex}-${unit.key}-${testId}`,
              prismaClient: prisma,
            }),
            { message: PLANET_UNIT_TRANSACTION_ERROR },
          )
        }
      }
    }
    assert.equal(
      await prisma.planetUnitTransaction.count(),
      countBeforeCrossFactionChecks,
    )

    const countBeforeOverdraft = await prisma.planetUnitTransaction.count()
    await assert.rejects(
      applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[0],
        planetId: planetIds[0],
        unitKey: "heavy-tank",
        delta: -1n,
        operationKey: `overdraft-${testId}`,
        prismaClient: prisma,
      }),
      { message: PLANET_UNIT_TRANSACTION_ERROR },
    )
    assert.equal(
      await prisma.planetUnitStack.count({
        where: { planetId: planetIds[0], unitKey: "heavy-tank" },
      }),
      0,
    )
    assert.equal(await prisma.planetUnitTransaction.count(), countBeforeOverdraft)

    await prisma.planetUnitStack.upsert({
      where: {
        planetId_unitKey: {
          planetId: planetIds[0],
          unitKey: "heavy-tank",
        },
      },
      update: { quantity: BIGINT_MAXIMUM },
      create: {
        planetId: planetIds[0],
        unitKey: "heavy-tank",
        quantity: BIGINT_MAXIMUM,
      },
    })
    await assert.rejects(
      applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[0],
        planetId: planetIds[0],
        unitKey: "heavy-tank",
        delta: 1n,
        operationKey: `overflow-${testId}`,
        prismaClient: prisma,
      }),
      { message: PLANET_UNIT_TRANSACTION_ERROR },
    )
    assert.equal(
      (await prisma.planetUnitStack.findUnique({
        where: {
          planetId_unitKey: {
            planetId: planetIds[0],
            unitKey: "heavy-tank",
          },
        },
      })).quantity,
      BIGINT_MAXIMUM,
    )
    assert.equal(await prisma.planetUnitTransaction.count(), countBeforeOverdraft)
  })
})

test("concurrent retries apply once and distinct operations lose no updates", async () => {
  await withSyntheticCivilizations(async ({ prisma, testId, ownerIds, planetIds }) => {
    const retryKey = `retry-${testId}`
    const retries = await Promise.all(
      Array.from({ length: 12 }, () =>
        applyPlanetUnitTransactionForOwner({
          ownerId: ownerIds[0],
          planetId: planetIds[0],
          unitKey: "line-infantry",
          delta: 3n,
          operationKey: retryKey,
          prismaClient: prisma,
        }),
      ),
    )
    assert.equal(new Set(retries.map(({ quantity }) => quantity)).size, 1)
    assert.equal(retries[0].quantity, "3")
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: planetIds[0] } }),
      1,
    )

    const distinct = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        applyPlanetUnitTransactionForOwner({
          ownerId: ownerIds[0],
          planetId: planetIds[0],
          unitKey: "line-infantry",
          delta: 1n,
          operationKey: `distinct-${index}-${testId}`,
          prismaClient: prisma,
        }),
      ),
    )
    assert.equal(new Set(distinct.map(({ quantity }) => quantity)).size, 20)
    assert.equal(
      (await prisma.planetUnitStack.findUnique({
        where: {
          planetId_unitKey: {
            planetId: planetIds[0],
            unitKey: "line-infantry",
          },
        },
      })).quantity,
      23n,
    )
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: planetIds[0] } }),
      21,
    )
  })
})

test("stack and ledger failures roll back the complete transaction", async () => {
  await withSyntheticCivilizations(async ({ prisma, testId, ownerIds, planetIds }) => {
    function wrappedClient({ failStack = false, failLedger = false }) {
      return {
        async $transaction(run) {
          return prisma.$transaction(async (transaction) => run({
            $queryRaw: (...args) => transaction.$queryRaw(...args),
            planetUnitStack: {
              findUnique: transaction.planetUnitStack.findUnique.bind(
                transaction.planetUnitStack,
              ),
              upsert: failStack
                ? async () => { throw new Error("synthetic stack failure") }
                : transaction.planetUnitStack.upsert.bind(transaction.planetUnitStack),
            },
            planetUnitTransaction: {
              findUnique: transaction.planetUnitTransaction.findUnique.bind(
                transaction.planetUnitTransaction,
              ),
              create: failLedger
                ? async () => { throw new Error("synthetic ledger failure") }
                : transaction.planetUnitTransaction.create.bind(
                    transaction.planetUnitTransaction,
                  ),
            },
          }))
        },
      }
    }

    for (const [label, client] of [
      ["stack", wrappedClient({ failStack: true })],
      ["ledger", wrappedClient({ failLedger: true })],
    ]) {
      await assert.rejects(
        applyPlanetUnitTransactionForOwner({
          ownerId: ownerIds[0],
          planetId: planetIds[0],
          unitKey: "line-infantry",
          delta: 4n,
          operationKey: `${label}-${testId}`,
          prismaClient: client,
        }),
        { message: PLANET_UNIT_TRANSACTION_ERROR },
      )
      assert.equal(
        await prisma.planetUnitStack.count({ where: { planetId: planetIds[0] } }),
        0,
      )
      assert.equal(
        await prisma.planetUnitTransaction.count({ where: { planetId: planetIds[0] } }),
        0,
      )
    }
  })
})

test("unit history is exact, faction-aware, deterministic, limited, and read-only", async () => {
  const createdAt = new Date("2026-10-01T10:00:00.000Z")
  let receivedQuery
  const planet = await queryOwnedPlanetById({
    planetId: "planet-owned",
    ownerId: "authenticated-owner",
    factionKey: "orthevan-directorate",
    planetModel: {
      async findFirst(query) {
        receivedQuery = query
        return {
          id: "planet-owned",
          name: "Owned Planet",
          materials: 0n,
          materialTransactions: [],
          unitTransactions: [{
            unitKey: "line-infantry",
            delta: 9_007_199_254_740_993n,
            quantityAfter: 9_007_199_254_740_993n,
            createdAt,
          }],
        }
      },
    },
  })
  assert.deepEqual(receivedQuery.select.unitTransactions, {
    select: {
      unitKey: true,
      delta: true,
      quantityAfter: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  })
  assert.deepEqual(planet.unitHistory, [{
    unitKey: "line-infantry",
    unitName: "Line Infantry",
    delta: "9007199254740993",
    quantityAfter: "9007199254740993",
    createdAt: "2026-10-01T10:00:00.000Z",
  }])
  assert.deepEqual(Object.keys(planet.unitHistory[0]), [
    "unitKey",
    "unitName",
    "delta",
    "quantityAfter",
    "createdAt",
  ])

  for (const transaction of [
    { unitKey: "razor-beast", delta: 1n, quantityAfter: 1n, createdAt },
    { unitKey: "unknown-unit", delta: 1n, quantityAfter: 1n, createdAt },
    { unitKey: "line-infantry", delta: 0n, quantityAfter: 1n, createdAt },
    { unitKey: "line-infantry", delta: 1n, quantityAfter: -1n, createdAt },
    {
      unitKey: "line-infantry",
      delta: 1n,
      quantityAfter: 1n,
      createdAt: new Date(Number.NaN),
    },
  ]) {
    await assert.rejects(
      queryOwnedPlanetById({
        planetId: "planet-owned",
        ownerId: "authenticated-owner",
        factionKey: "orthevan-directorate",
        planetModel: {
          async findFirst() {
            return {
              id: "planet-owned",
              name: "Owned Planet",
              materials: 0n,
              materialTransactions: [],
              unitTransactions: [transaction],
            }
          },
        },
      }),
      { message: PLANETARY_FORCES_ERROR },
    )
  }

  await withSyntheticCivilizations(async ({ prisma, testId, ownerIds, planetIds }) => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `history-${testId}-${String(index).padStart(2, "0")}`,
      planetId: planetIds[0],
      unitKey: "line-infantry",
      delta: BigInt(index + 1),
      quantityAfter: BigInt(index + 1),
      createdAt: new Date(Date.UTC(2026, 9, 1, 10, 0, Math.floor(index / 2))),
    }))
    await prisma.planetUnitTransaction.createMany({ data: rows })
    const expectedIds = [...rows]
      .sort((left, right) => {
        const dateDifference = right.createdAt.getTime() - left.createdAt.getTime()
        return dateDifference === 0
          ? right.id.localeCompare(left.id)
          : dateDifference
      })
      .slice(0, 20)
    const owned = await queryOwnedPlanetById({
      planetId: planetIds[0],
      ownerId: ownerIds[0],
      factionKey: FACTION_KEYS[0],
      planetModel: prisma.planet,
    })
    assert.equal(owned.unitHistory.length, 20)
    assert.deepEqual(
      owned.unitHistory.map(({ delta }) => delta),
      expectedIds.map(({ delta }) => delta.toString()),
    )
    assert.equal(
      await queryOwnedPlanetById({
        planetId: planetIds[1],
        ownerId: ownerIds[0],
        factionKey: FACTION_KEYS[0],
        planetModel: prisma.planet,
      }),
      null,
    )
  })

  const page = await source("app/planets/[planetId]/page.js")
  const styles = await source("app/globals.css")
  const historySection = page.match(
    /<section\s+className="unit-history"[\s\S]*?<\/section>/u,
  )?.[0]
  assert.ok(historySection)
  assert.doesNotMatch(page, /^["']use client["']/mu)
  assert.match(historySection, />Planetary force history<\/h2>/u)
  assert.match(historySection, />\s*No planetary force changes yet\.\s*<\/p>/u)
  assert.match(historySection, /\{entry\.unitName\}/u)
  assert.match(historySection, /signedDelta\(entry\.delta\)/u)
  assert.match(historySection, /Resulting quantity: \{entry\.quantityAfter\}/u)
  assert.match(
    historySection,
    /<time dateTime=\{entry\.createdAt\}>\{entry\.createdAt\}<\/time>/u,
  )
  assert.doesNotMatch(
    historySection,
    /<form|<input|<button|transactionId|operationKey|ownerId/iu,
  )
  assert.match(styles, /\.unit-history li \{[\s\S]*min-width: 0/u)
  assert.match(styles, /\.unit-history-heading time \{[\s\S]*overflow-wrap: anywhere/u)
})

test("reset deletes unit state atomically and serializes against unit transactions", async () => {
  await withSyntheticCivilizations(async ({ prisma, testId, ownerIds, planetIds }) => {
    const accountId = `unit-tx-account-${testId}`
    const sessionId = `unit-tx-session-${testId}`
    await prisma.account.create({
      data: {
        id: accountId,
        accountId: ownerIds[0],
        providerId: "credential",
        userId: ownerIds[0],
        password: "synthetic-hashed-password",
      },
    })
    await prisma.session.create({
      data: {
        id: sessionId,
        token: `unit-tx-token-${testId}`,
        userId: ownerIds[0],
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    })
    for (const index of [0, 1]) {
      await applyPlanetUnitTransactionForOwner({
        ownerId: ownerIds[index],
        planetId: planetIds[index],
        unitKey: "line-infantry",
        delta: 2n,
        operationKey: `reset-source-${index}-${testId}`,
        prismaClient: prisma,
      })
    }

    await resetCivilizationForUser({
      userId: ownerIds[0],
      confirmation: RESET_CIVILIZATION_CONFIRMATION,
      prismaClient: prisma,
    })
    assert.equal(await prisma.planet.count({ where: { ownerId: ownerIds[0] } }), 0)
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: planetIds[0] } }),
      0,
    )
    assert.equal(
      await prisma.planetUnitStack.count({ where: { planetId: planetIds[0] } }),
      0,
    )
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: planetIds[1] } }),
      1,
    )
    assert.equal(
      await prisma.planetUnitStack.count({ where: { planetId: planetIds[1] } }),
      1,
    )
    assert.equal(await prisma.account.count({ where: { id: accountId } }), 1)
    assert.equal(await prisma.session.count({ where: { id: sessionId } }), 1)

    const raceOwnerId = ownerIds[2]
    const racePlanetId = planetIds[2]
    const race = await Promise.allSettled([
      applyPlanetUnitTransactionForOwner({
        ownerId: raceOwnerId,
        planetId: racePlanetId,
        unitKey: "line-infantry",
        delta: 1n,
        operationKey: `race-${testId}`,
        prismaClient: prisma,
      }),
      resetCivilizationForUser({
        userId: raceOwnerId,
        confirmation: RESET_CIVILIZATION_CONFIRMATION,
        prismaClient: prisma,
      }),
    ])
    assert.equal(race[1].status, "fulfilled")
    assert.equal(
      (await prisma.user.findUnique({
        where: { id: raceOwnerId },
        select: { factionKey: true },
      })).factionKey,
      null,
    )
    assert.equal(await prisma.planet.count({ where: { id: racePlanetId } }), 0)
    assert.equal(
      await prisma.planetUnitTransaction.count({ where: { planetId: racePlanetId } }),
      0,
    )
    assert.equal(
      await prisma.planetUnitStack.count({ where: { planetId: racePlanetId } }),
      0,
    )
  })

  const policy = await source("lib/civilization-policy.js")
  const transactionDelete = policy.indexOf("planetUnitTransaction.deleteMany")
  const stackDelete = policy.indexOf("planetUnitStack.deleteMany")
  const materialDelete = policy.indexOf("planetMaterialTransaction.deleteMany")
  const planetDelete = policy.indexOf("planet.deleteMany")
  assert.ok(transactionDelete > 0)
  assert.ok(stackDelete > transactionDelete)
  assert.ok(materialDelete > stackDelete)
  assert.ok(planetDelete > materialDelete)

  const resetPage = await source("app/civilization/reset/page.js")
  assert.match(resetPage, /All planetary ground-force history/u)
})
