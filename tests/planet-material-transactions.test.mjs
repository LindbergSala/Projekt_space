import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { queryOwnedPlanetById } from "../lib/owned-planets-query.js"
import {
  applyPlanetMaterialsTransactionForOwner,
  createPlanetMaterialTransactionId,
  PLANET_MATERIALS_TRANSACTION_ERROR,
} from "../lib/planet-materials-policy.js"
import { renamePlanetForOwner } from "../lib/planet-name-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

function createLocalPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  })
}

async function withSyntheticPlanets(run) {
  const prisma = createLocalPrismaClient()
  const testId = randomUUID()
  const ownerId = `material-transaction-owner-${testId}`
  const otherOwnerId = `material-transaction-other-${testId}`
  const planetId = `material-transaction-planet-${testId}`
  const otherPlanetId = `material-transaction-foreign-${testId}`
  const ownerIds = [ownerId, otherOwnerId]
  const planetIds = [planetId, otherPlanetId]

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_user AS user_name, current_database() AS database_name
    `
    assert.deepEqual(identity, [{
      user_name: "projekt_space_app",
      database_name: "projekt_space_dev",
    }])

    const baseline = {
      users: await prisma.user.count({ where: { id: { in: ownerIds } } }),
      planets: await prisma.planet.count({ where: { id: { in: planetIds } } }),
      transactions: await prisma.planetMaterialTransaction.count({
        where: { planetId: { in: planetIds } },
      }),
    }
    assert.deepEqual(baseline, { users: 0, planets: 0, transactions: 0 })

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Material Transaction Owner",
          email: `${ownerId}@example.invalid`,
        },
        {
          id: otherOwnerId,
          name: "Material Transaction Other",
          email: `${otherOwnerId}@example.invalid`,
        },
      ],
    })
    await prisma.planet.createMany({
      data: [
        { id: planetId, ownerId },
        { id: otherPlanetId, ownerId: otherOwnerId },
      ],
    })

    await run({
      prisma,
      ownerId,
      otherOwnerId,
      planetId,
      otherPlanetId,
      testId,
    })
  } finally {
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planet.deleteMany({
      where: { id: { in: planetIds } },
    }).catch(() => {})
    await prisma.user.deleteMany({
      where: { id: { in: ownerIds } },
    }).catch(() => {})

    assert.equal(
      await prisma.planetMaterialTransaction.count({
        where: { planetId: { in: planetIds } },
      }),
      0,
    )
    assert.equal(
      await prisma.planet.count({ where: { id: { in: planetIds } } }),
      0,
    )
    assert.equal(
      await prisma.user.count({ where: { id: { in: ownerIds } } }),
      0,
    )
    await prisma.$disconnect()
  }
}

test("schema and migration add only the immutable per-planet Materials ledger", async () => {
  const schema = await source("prisma/schema.prisma")
  const migrationDirectories = await readdir(
    path.join(ROOT_DIRECTORY, "prisma/migrations"),
    { withFileTypes: true },
  )
  const ledgerMigration = migrationDirectories.find(
    (entry) =>
      entry.isDirectory() &&
      entry.name.endsWith("_add_planet_material_transactions"),
  )

  assert.match(schema, /model PlanetMaterialTransaction \{/u)
  assert.match(schema, /id\s+String\s+@id/u)
  assert.match(schema, /planetId\s+String/u)
  assert.match(schema, /delta\s+BigInt\s+@db\.BigInt/u)
  assert.match(schema, /balanceAfter\s+BigInt\s+@db\.BigInt/u)
  assert.match(schema, /createdAt\s+DateTime\s+@default\(now\(\)\)/u)
  assert.match(
    schema,
    /@relation\(fields: \[planetId\], references: \[id\], onDelete: Restrict, onUpdate: Cascade\)/u,
  )
  assert.match(
    schema,
    /@@index\(\[planetId, createdAt, id\], map: "planet_material_history_idx"\)/u,
  )
  assert.match(schema, /@@map\("planet_material_transaction"\)/u)
  assert.ok(ledgerMigration)

  const migration = await source(
    `prisma/migrations/${ledgerMigration.name}/migration.sql`,
  )
  assert.equal(
    migration.replaceAll("\r\n", "\n").trim(),
    [
      "-- CreateTable",
      'CREATE TABLE "planet_material_transaction" (',
      '    "id" TEXT NOT NULL,',
      '    "planetId" TEXT NOT NULL,',
      '    "delta" BIGINT NOT NULL,',
      '    "balanceAfter" BIGINT NOT NULL,',
      '    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      "",
      '    CONSTRAINT "planet_material_transaction_pkey" PRIMARY KEY ("id")',
      ");",
      "",
      "-- AddCheckConstraints",
      'ALTER TABLE "planet_material_transaction"',
      '    ADD CONSTRAINT "planet_material_transaction_delta_nonzero" CHECK ("delta" <> 0),',
      '    ADD CONSTRAINT "planet_material_transaction_balance_nonnegative" CHECK ("balanceAfter" >= 0);',
      "",
      "-- CreateIndex",
      'CREATE INDEX "planet_material_history_idx" ON "planet_material_transaction"("planetId", "createdAt", "id");',
      "",
      "-- AddForeignKey",
      'ALTER TABLE "planet_material_transaction" ADD CONSTRAINT "planet_material_transaction_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
    ].join("\n"),
  )
  assert.doesNotMatch(
    migration,
    /CREATE TRIGGER|CREATE FUNCTION|GRANT|^\s*(?:INSERT|UPDATE|DELETE)\s|ALTER TABLE "planet"(?:\s|$)/imu,
  )
})

test("operation keys are validated, hashed, versioned, and never stored raw", async () => {
  const policy = await source("lib/planet-materials-policy.js")
  const operationKey = "trusted-gameplay-operation"
  const transactionId = createPlanetMaterialTransactionId(operationKey)

  assert.equal(transactionId, createPlanetMaterialTransactionId(operationKey))
  assert.notEqual(
    transactionId,
    createPlanetMaterialTransactionId("another-gameplay-operation"),
  )
  assert.match(transactionId, /^material_transaction_[a-f0-9]{64}$/u)
  assert.equal(transactionId.includes(operationKey), false)
  assert.match(
    policy,
    /TRANSACTION_ID_DOMAIN = "projekt-space\/material-transaction\/v1\\0"/u,
  )
  assert.doesNotMatch(policy, /data:\s*\{[^}]*operationKey/su)
  assert.doesNotMatch(
    policy,
    /planetMaterialTransaction\.(?:update|updateMany|delete|deleteMany)/u,
  )
  assert.match(
    policy,
    /WHERE "id" = \$\{planetId\}[\s\S]*AND "ownerId" = \$\{ownerId\}[\s\S]*FOR UPDATE/u,
  )
  assert.ok(
    policy.indexOf("FOR UPDATE") <
      policy.indexOf("planetMaterialTransaction.findUnique"),
  )

  for (const invalidKey of [undefined, null, "", " padded ", "x".repeat(257)]) {
    assert.throws(() => createPlanetMaterialTransactionId(invalidKey), {
      message: PLANET_MATERIALS_TRANSACTION_ERROR,
    })
  }
})

test("invalid deltas and database failures expose one generic error", async () => {
  let transactionCount = 0
  const prismaClient = {
    async $transaction() {
      transactionCount += 1
      throw new Error("raw database detail")
    },
  }
  const base = {
    ownerId: "authenticated-owner",
    planetId: "planet-owned",
    operationKey: "valid-operation",
    prismaClient,
  }

  for (const delta of [0n, 1, Number.MAX_SAFE_INTEGER, null]) {
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({ ...base, delta }),
      { message: PLANET_MATERIALS_TRANSACTION_ERROR },
    )
  }
  for (const delta of [
    POSTGRES_BIGINT_MAXIMUM + 1n,
    -POSTGRES_BIGINT_MAXIMUM - 2n,
  ]) {
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({ ...base, delta }),
      { message: PLANET_MATERIALS_TRANSACTION_ERROR },
    )
  }
  assert.equal(transactionCount, 0)

  await assert.rejects(
    applyPlanetMaterialsTransactionForOwner({ ...base, delta: 1n }),
    (error) =>
      error.message === PLANET_MATERIALS_TRANSACTION_ERROR &&
      !error.message.includes("raw database detail"),
  )
  assert.equal(transactionCount, 1)
})

test("authenticated operation derives owner identity and has no browser entry point", async () => {
  const operation = await source("lib/owned-planets.js")
  const actions = await source("app/planets/actions.js")
  const page = await source("app/planets/[planetId]/page.js")

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    operation,
    /export async function applyAuthenticatedPlanetMaterialsTransaction\(input\)/u,
  )
  assert.match(operation, /const ownerId = await requireAuthenticatedUserId\(\)/u)
  assert.match(
    operation,
    /const \{ planetId, delta, operationKey \} = input \?\? \{\}/u,
  )
  assert.match(
    operation,
    /applyPlanetMaterialsTransactionForOwner\(\{\s*ownerId,\s*planetId,\s*delta,\s*operationKey,\s*prismaClient: prisma,/u,
  )
  assert.doesNotMatch(actions, /Materials|materials|operationKey|delta/u)
  assert.doesNotMatch(
    page,
    /name=["'](?:materials|delta|operationKey)["']/iu,
  )
})

test("detail history selects no identifiers and serializes exact values", async () => {
  const createdAt = new Date("2026-09-27T06:00:00.000Z")
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
          materials: 9_007_199_254_740_994n,
          materialTransactions: [{
            delta: 9_007_199_254_740_993n,
            balanceAfter: 9_007_199_254_740_994n,
            createdAt,
          }],
          unitTransactions: [],
        }
      },
    },
  })

  assert.deepEqual(receivedQuery.where, {
    id: "planet-owned",
    ownerId: "authenticated-owner",
  })
  assert.deepEqual(receivedQuery.select.materialTransactions, {
    select: { delta: true, balanceAfter: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  })
  assert.deepEqual(planet, {
    id: "planet-owned",
    name: "Owned Planet",
    materials: "9007199254740994",
    materialHistory: [{
      delta: "9007199254740993",
      balanceAfter: "9007199254740994",
      createdAt: "2026-09-27T06:00:00.000Z",
    }],
    unitHistory: [],
  })
  assert.equal(JSON.stringify(planet).includes("transactionId"), false)
  assert.equal(JSON.stringify(planet).includes("ownerId"), false)
})

test("local transactions are atomic, idempotent, precise, and owner-protected", async () => {
  await withSyntheticPlanets(async ({
    prisma,
    ownerId,
    otherOwnerId,
    planetId,
    otherPlanetId,
    testId,
  }) => {
    assert.deepEqual(
      await queryOwnedPlanetById({
        planetId,
        ownerId,
        factionKey: "orthevan-directorate",
        planetModel: prisma.planet,
      }),
      {
        id: planetId,
        name: "Unnamed Planet",
        materials: "0",
        materialHistory: [],
        unitHistory: [],
      },
    )

    await assert.rejects(
      prisma.planetMaterialTransaction.create({
        data: {
          id: `invalid-zero-${testId}`,
          planetId,
          delta: 0n,
          balanceAfter: 0n,
        },
      }),
    )
    await assert.rejects(
      prisma.planetMaterialTransaction.create({
        data: {
          id: `invalid-balance-${testId}`,
          planetId,
          delta: 1n,
          balanceAfter: -1n,
        },
      }),
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId } }),
      0,
    )

    let missingErrorMessage
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId: `missing-${testId}`,
        delta: 1n,
        operationKey: `missing-${testId}`,
        prismaClient: prisma,
      }),
      (error) => {
        missingErrorMessage = error.message
        return true
      },
    )
    let foreignErrorMessage
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId: otherPlanetId,
        delta: 1n,
        operationKey: `foreign-${testId}`,
        prismaClient: prisma,
      }),
      (error) => {
        foreignErrorMessage = error.message
        return true
      },
    )
    assert.equal(missingErrorMessage, PLANET_MATERIALS_TRANSACTION_ERROR)
    assert.equal(foreignErrorMessage, missingErrorMessage)

    const largeDelta = 9_007_199_254_740_993n
    const creditKey = `credit-${testId}`
    assert.deepEqual(
      await applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: largeDelta,
        operationKey: creditKey,
        prismaClient: prisma,
      }),
      { delta: "9007199254740993", balanceAfter: "9007199254740993" },
    )
    assert.deepEqual(
      await applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: largeDelta,
        operationKey: creditKey,
        prismaClient: prisma,
      }),
      { delta: "9007199254740993", balanceAfter: "9007199254740993" },
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({
        where: { id: createPlanetMaterialTransactionId(creditKey) },
      }),
      1,
    )
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({
        ownerId: otherOwnerId,
        planetId: otherPlanetId,
        delta: largeDelta,
        operationKey: creditKey,
        prismaClient: prisma,
      }),
      { message: PLANET_MATERIALS_TRANSACTION_ERROR },
    )
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: otherPlanetId },
        select: { materials: true },
      }),
      { materials: 0n },
    )

    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: largeDelta - 1n,
        operationKey: creditKey,
        prismaClient: prisma,
      }),
      { message: PLANET_MATERIALS_TRANSACTION_ERROR },
    )

    assert.deepEqual(
      await applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: -(largeDelta - 1n),
        operationKey: `debit-${testId}`,
        prismaClient: prisma,
      }),
      { delta: "-9007199254740992", balanceAfter: "1" },
    )
    assert.deepEqual(
      await applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: -1n,
        operationKey: `spend-to-zero-${testId}`,
        prismaClient: prisma,
      }),
      { delta: "-1", balanceAfter: "0" },
    )

    const ledgerCountBeforeFailure =
      await prisma.planetMaterialTransaction.count({ where: { planetId } })
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: -1n,
        operationKey: `overdraft-${testId}`,
        prismaClient: prisma,
      }),
      { message: PLANET_MATERIALS_TRANSACTION_ERROR },
    )
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { materials: true },
      }),
      { materials: 0n },
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId } }),
      ledgerCountBeforeFailure,
    )

    await prisma.planet.update({
      where: { id: planetId },
      data: { materials: POSTGRES_BIGINT_MAXIMUM },
    })
    await assert.rejects(
      applyPlanetMaterialsTransactionForOwner({
        ownerId,
        planetId,
        delta: 1n,
        operationKey: `overflow-${testId}`,
        prismaClient: prisma,
      }),
      { message: PLANET_MATERIALS_TRANSACTION_ERROR },
    )
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { materials: true },
      }),
      { materials: POSTGRES_BIGINT_MAXIMUM },
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId } }),
      ledgerCountBeforeFailure,
    )

    await renamePlanetForOwner({
      ownerId,
      planetId,
      planetName: "Ledger Prime",
      planetModel: prisma.planet,
    })
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { name: true, materials: true },
      }),
      { name: "Ledger Prime", materials: POSTGRES_BIGINT_MAXIMUM },
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId } }),
      ledgerCountBeforeFailure,
    )
  })
})

test("concurrent retries apply once and distinct operations lose no updates", async () => {
  await withSyntheticPlanets(async ({ prisma, ownerId, planetId, testId }) => {
    const retryKey = `concurrent-retry-${testId}`
    const retryResults = await Promise.all(
      Array.from({ length: 12 }, () =>
        applyPlanetMaterialsTransactionForOwner({
          ownerId,
          planetId,
          delta: 3n,
          operationKey: retryKey,
          prismaClient: prisma,
        }),
      ),
    )
    assert.deepEqual(
      new Set(retryResults.map((result) => JSON.stringify(result))),
      new Set([JSON.stringify({ delta: "3", balanceAfter: "3" })]),
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId } }),
      1,
    )

    const distinctResults = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        applyPlanetMaterialsTransactionForOwner({
          ownerId,
          planetId,
          delta: 1n,
          operationKey: `concurrent-distinct-${testId}-${index}`,
          prismaClient: prisma,
        }),
      ),
    )
    assert.equal(new Set(distinctResults.map((result) => result.balanceAfter)).size, 20)
    assert.deepEqual(
      await prisma.planet.findUnique({
        where: { id: planetId },
        select: { materials: true },
      }),
      { materials: 23n },
    )
    assert.equal(
      await prisma.planetMaterialTransaction.count({ where: { planetId } }),
      21,
    )
  })
})

test("history is owner-protected, deterministic, limited, and read-only in UI", async () => {
  await withSyntheticPlanets(async ({
    prisma,
    ownerId,
    planetId,
    otherPlanetId,
    testId,
  }) => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `material-history-${testId}-${String(index).padStart(2, "0")}`,
      planetId,
      delta: BigInt(index + 1),
      balanceAfter: BigInt(index + 1),
      createdAt: new Date(Date.UTC(2026, 8, 27, 6, 0, Math.floor(index / 2))),
    }))
    await prisma.planetMaterialTransaction.createMany({ data: rows })

    const expected = [...rows]
      .sort((left, right) => {
        const dateDifference = right.createdAt.getTime() - left.createdAt.getTime()
        return dateDifference === 0
          ? right.id.localeCompare(left.id)
          : dateDifference
      })
      .slice(0, 20)
      .map(({ delta, balanceAfter, createdAt }) => ({
        delta: delta.toString(),
        balanceAfter: balanceAfter.toString(),
        createdAt: createdAt.toISOString(),
      }))

    const owned = await queryOwnedPlanetById({
      planetId,
      ownerId,
      factionKey: "orthevan-directorate",
      planetModel: prisma.planet,
    })
    assert.deepEqual(owned.materialHistory, expected)
    assert.equal(owned.materialHistory.length, 20)
    assert.equal(
      await queryOwnedPlanetById({
        planetId: otherPlanetId,
        ownerId,
        factionKey: "orthevan-directorate",
        planetModel: prisma.planet,
      }),
      null,
    )
  })

  const page = await source("app/planets/[planetId]/page.js")
  assert.doesNotMatch(page, /^['"]use client['"]/mu)
  assert.match(page, />Materials history<\/h2>/u)
  assert.match(page, />No material changes yet\.<\/p>/u)
  assert.match(page, /signedDelta\(entry\.delta\)/u)
  assert.match(page, /Balance: \{entry\.balanceAfter\}/u)
  assert.match(page, /<time dateTime=\{entry\.createdAt\}>\{entry\.createdAt\}<\/time>/u)
  assert.doesNotMatch(page, /transaction\.id|entry\.id|ownerId|operationKey/u)
})
