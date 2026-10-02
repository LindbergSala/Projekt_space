import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"

import { CIVILIZATION_RESET_ERROR, RESET_CIVILIZATION_CONFIRMATION, resetCivilizationForUser } from "../lib/civilization-policy.js"
import { selectFactionForUser } from "../lib/faction-policy.js"
import { getInfrastructureStep } from "../lib/planet-infrastructure.js"
import { collectPlanetRecruitmentForOwner, startPlanetRecruitmentForOwner } from "../lib/planet-recruitment-policy.js"
import { ensureStarterPlanetForOwner } from "../lib/starter-planet-policy.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const FACTION = "orthevan-directorate"
const MAXIMUM = 9_223_372_036_854_775_807n

async function verifiedLocalPrisma() {
  const databaseUrl = process.env.DATABASE_URL
  assert.equal(typeof databaseUrl, "string")
  parseCompatibleDatabaseUrl(databaseUrl)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  const [identity] = await prisma.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
      rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
  `
  assert.deepEqual(identity, {
    database: "projekt_space_dev", role: "projekt_space_app", rolsuper: false,
    rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false,
  })
  return prisma
}

function syntheticOrderId() {
  return `recruitment_${createHash("sha256").update(randomUUID()).digest("hex")}`
}

async function databaseTime(prisma) {
  const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
  return currentTime
}

async function cleanupOwners(prisma, ownerIds) {
  const where = { planet: { ownerId: { in: ownerIds } } }
  await prisma.planetRecruitment.deleteMany({ where })
  await prisma.planetConstruction.deleteMany({ where })
  await prisma.planetUnitTransaction.deleteMany({ where })
  await prisma.planetUnitStack.deleteMany({ where })
  await prisma.planetMaterialTransaction.deleteMany({ where })
  await prisma.planet.deleteMany({ where: { ownerId: { in: ownerIds } } })
  await prisma.user.deleteMany({ where: { id: { in: ownerIds } } })
}

test("recruitment migration adds only durable order history and the explicit partial unique index", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  const sql = await readFile(new URL("../prisma/migrations/20261002180000_add_planet_recruitment/migration.sql", import.meta.url), "utf8")
  const model = schema.match(/model PlanetRecruitment \{([\s\S]*?)\n\}/u)?.[1]
  assert.ok(model)
  assert.match(schema, /recruitments\s+PlanetRecruitment\[\]/u)
  assert.match(model, /quantity\s+BigInt\s+@db\.BigInt/u)
  assert.match(model, /materialsCost\s+BigInt\s+@db\.BigInt/u)
  for (const field of ["startedAt", "completesAt"]) assert.match(model, new RegExp(`${field}\\s+DateTime\\s+@db\\.Timestamp\\(3\\)`, "u"))
  assert.match(model, /collectedAt\s+DateTime\?\s+@db\.Timestamp\(3\)/u)
  assert.match(model, /onDelete: Restrict, onUpdate: Cascade/u)
  assert.match(model, /@@index\(\[planetId, startedAt, id\], map: "planet_recruitment_history_idx"\)/u)
  assert.equal((sql.match(/CREATE TABLE/gu) ?? []).length, 1)
  assert.match(sql, /CREATE TABLE "planet_recruitment"/u)
  assert.match(sql, /CREATE UNIQUE INDEX "planet_recruitment_uncollected_key"[\s\S]*?WHERE "collectedAt" IS NULL/u)
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|GRANT|CREATE TRIGGER|CREATE FUNCTION)\b/imu)
  assert.doesNotMatch(sql, /\bnow\s*\(/iu)
  assert.deepEqual([...sql.matchAll(/ALTER TABLE "([^"]+)"/gu)].map((match) => match[1]), ["planet_recruitment"])
})

test("local PostgreSQL enforces recruitment checks, immutable-time slot predicate and Restrict/Cascade relations", async (t) => {
  const prisma = await verifiedLocalPrisma()
  const directClient = new Client({ connectionString: process.env.DATABASE_URL })
  const ownerId = `recruitment-schema-${randomUUID()}`
  const planetId = `recruitment-schema-planet-${randomUUID()}`
  const updatedPlanetId = `${planetId}-updated`
  try {
    await directClient.connect()
    const identity = await directClient.query('SELECT current_user AS role, current_database() AS database')
    assert.deepEqual(identity.rows, [{ role: "projekt_space_app", database: "projekt_space_dev" }])
    await prisma.user.create({ data: { id: ownerId, name: "Synthetic constraint owner", email: `${ownerId}@example.invalid`, factionKey: FACTION } })
    await prisma.planet.create({ data: { id: planetId, ownerId } })
    const now = await databaseTime(prisma)
    const valid = {
      id: syntheticOrderId(), planetId, unitKey: "line-infantry", quantity: 1n, materialsCost: 10n,
      startedAt: now, completesAt: new Date(now.getTime() + 300_000), collectedAt: null,
    }

    await t.test("restricted runtime and migrator retain their reviewed ownership and privilege boundaries", async () => {
      const roles = await prisma.$queryRaw`
        SELECT rolname::text AS name, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
          (SELECT count(*)::int FROM pg_auth_members WHERE member = roles.oid OR roleid = roles.oid) AS memberships
          FROM pg_roles AS roles WHERE rolname IN ('projekt_space_app', 'projekt_space_migrator') ORDER BY rolname
      `
      assert.deepEqual(roles, ["projekt_space_app", "projekt_space_migrator"].map((name) => ({
        name, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: 0,
      })))
      const [ownership] = await prisma.$queryRaw`
        SELECT pg_get_userbyid(database.datdba)::text AS database_owner,
          pg_get_userbyid(namespace.nspowner)::text AS schema_owner,
          has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
          has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
          has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage
          FROM pg_database AS database CROSS JOIN pg_namespace AS namespace
          WHERE database.datname = current_database() AND namespace.nspname = 'public'
      `
      assert.equal(["projekt_space_app", "projekt_space_migrator"].includes(ownership.database_owner), false)
      assert.equal(["projekt_space_app", "projekt_space_migrator"].includes(ownership.schema_owner), false)
      assert.equal(ownership.database_create, false)
      assert.equal(ownership.schema_create, false)
      assert.equal(ownership.schema_usage, true)
      const tableOwners = await prisma.$queryRaw`
        SELECT relname::text AS name, pg_get_userbyid(relowner)::text AS owner
          FROM pg_class WHERE oid IN ('public.planet_recruitment'::regclass, 'public._prisma_migrations'::regclass)
          ORDER BY relname
      `
      assert.deepEqual(tableOwners, ["_prisma_migrations", "planet_recruitment"].map((name) => ({ name, owner: "projekt_space_migrator" })))
      const permissions = await prisma.$queryRaw`
        SELECT permission, has_table_privilege(current_user, 'public.planet_recruitment', permission) AS recruitment,
          has_table_privilege(current_user, 'public._prisma_migrations', permission) AS migrations
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) AS permission
      `
      for (const permission of permissions) {
        assert.equal(permission.recruitment, ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(permission.permission))
        assert.equal(permission.migrations, false)
      }
      const forbiddenAcls = await prisma.$queryRaw`
        SELECT relation.relname::text AS name, privilege.privilege_type
          FROM pg_class AS relation
          CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS privilege
          WHERE relation.oid IN ('public.planet_recruitment'::regclass, 'public._prisma_migrations'::regclass)
            AND (privilege.grantee = 0 OR (
              privilege.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'projekt_space_app')
              AND (relation.relname = '_prisma_migrations' OR privilege.is_grantable)
            ))
      `
      assert.deepEqual(forbiddenAcls, [])
    })

    await t.test("catalog confirms all CHECKs and the unique collectedAt-null predicate", async () => {
      const constraints = await prisma.$queryRaw`
        SELECT conname, contype::text AS type, pg_get_constraintdef(oid) AS definition,
          confupdtype::text AS update_action, confdeltype::text AS delete_action, convalidated
          FROM pg_constraint WHERE conrelid = 'public.planet_recruitment'::regclass ORDER BY conname
      `
      const checks = constraints.filter(({ type }) => type === "c")
      assert.deepEqual(checks.map(({ conname }) => conname), [
        "planet_recruitment_collection_valid", "planet_recruitment_cost_positive", "planet_recruitment_quantity_positive",
        "planet_recruitment_time_valid", "planet_recruitment_unit_valid",
      ])
      assert.equal(constraints.every(({ convalidated }) => convalidated), true)
      assert.equal(constraints.filter(({ type }) => type === "p").length, 1)
      const foreignKey = constraints.find(({ type }) => type === "f")
      assert.equal(foreignKey.update_action, "c")
      assert.equal(foreignKey.delete_action, "r")
      const [index] = await prisma.$queryRaw`
        SELECT indisunique, indisvalid, pg_get_expr(indpred, indrelid) AS predicate,
          pg_get_indexdef(indexrelid) AS definition
          FROM pg_index WHERE indexrelid = 'public.planet_recruitment_uncollected_key'::regclass
      `
      assert.equal(index.indisunique, true)
      assert.equal(index.indisvalid, true)
      assert.match(index.predicate, /^\("collectedAt" IS NULL\)$/u)
      assert.match(index.definition, /\("planetId"\)/u)
      assert.doesNotMatch(index.predicate, /now|clock|completesAt/iu)
      const columns = await prisma.$queryRaw`
        SELECT column_name, data_type, datetime_precision, is_nullable
          FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'planet_recruitment'
            AND column_name IN ('quantity', 'materialsCost', 'startedAt', 'completesAt', 'collectedAt')
          ORDER BY column_name
      `
      assert.deepEqual(columns, [
        { column_name: "collectedAt", data_type: "timestamp without time zone", datetime_precision: 3, is_nullable: "YES" },
        { column_name: "completesAt", data_type: "timestamp without time zone", datetime_precision: 3, is_nullable: "NO" },
        { column_name: "materialsCost", data_type: "bigint", datetime_precision: null, is_nullable: "NO" },
        { column_name: "quantity", data_type: "bigint", datetime_precision: null, is_nullable: "NO" },
        { column_name: "startedAt", data_type: "timestamp without time zone", datetime_precision: 3, is_nullable: "NO" },
      ])
    })

    await t.test("invalid rows are rejected by PostgreSQL independently of application validation", async () => {
      for (const [override, constraint, code = "23514"] of [
        [{ quantity: 0n }, "planet_recruitment_quantity_positive"],
        [{ quantity: -1n }, "planet_recruitment_quantity_positive"],
        [{ materialsCost: 0n }, "planet_recruitment_cost_positive"],
        [{ materialsCost: -1n }, "planet_recruitment_cost_positive"],
        [{ unitKey: "assault-infantry" }, "planet_recruitment_unit_valid"],
        [{ unitKey: "unknown-unit" }, "planet_recruitment_unit_valid"],
        [{ completesAt: valid.startedAt }, "planet_recruitment_time_valid"],
        [{ completesAt: new Date(now.getTime() - 1) }, "planet_recruitment_time_valid"],
        [{ collectedAt: new Date(valid.completesAt.getTime() - 1) }, "planet_recruitment_collection_valid"],
        [{ planetId: "missing-planet" }, "planet_recruitment_planetId_fkey", "23503"],
      ]) {
        const data = { ...valid, id: syntheticOrderId(), ...override }
        await assert.rejects(directClient.query({
          text: 'INSERT INTO "planet_recruitment" ("id", "planetId", "unitKey", "quantity", "materialsCost", "startedAt", "completesAt", "collectedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          values: [data.id, data.planetId, data.unitKey, data.quantity, data.materialsCost, data.startedAt, data.completesAt, data.collectedAt],
        }), { code, constraint })
        assert.equal(await prisma.planetRecruitment.count({ where: { planetId } }), 0)
      }
      await prisma.planetRecruitment.create({ data: { ...valid, quantity: MAXIMUM, materialsCost: MAXIMUM } })
      const saved = await prisma.planetRecruitment.findUnique({ where: { id: valid.id } })
      assert.equal(saved.quantity, MAXIMUM)
      assert.equal(saved.materialsCost, MAXIMUM)
      await assert.rejects(prisma.planetRecruitment.create({ data: { ...valid, collectedAt: valid.completesAt } }))
      await prisma.planetRecruitment.delete({ where: { id: valid.id } })
    })

    await t.test("one uncollected order slot survives readiness and releases only when collected", async () => {
      const attempts = await Promise.allSettled([
        prisma.planetRecruitment.create({ data: { ...valid, id: syntheticOrderId() } }),
        prisma.planetRecruitment.create({ data: { ...valid, id: syntheticOrderId() } }),
      ])
      assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1)
      const first = attempts.find(({ status }) => status === "fulfilled").value
      const completesAt = new Date(now.getTime() - 1)
      await prisma.planetRecruitment.update({ where: { id: first.id }, data: {
        startedAt: new Date(completesAt.getTime() - 300_000), completesAt,
      } })
      await assert.rejects(prisma.planetRecruitment.create({ data: { ...valid, id: syntheticOrderId() } }))
      await prisma.planetRecruitment.update({ where: { id: first.id }, data: { collectedAt: completesAt } })
      await prisma.planetRecruitment.create({ data: { ...valid, id: syntheticOrderId(), collectedAt: valid.completesAt } })
      await prisma.planetRecruitment.create({ data: { ...valid, id: syntheticOrderId() } })
      assert.equal(await prisma.planetRecruitment.count({ where: { planetId } }), 3)
      assert.equal(await prisma.planetRecruitment.count({ where: { planetId, collectedAt: null } }), 1)
      await assert.rejects(prisma.planet.delete({ where: { id: planetId } }))
      await prisma.planet.update({ where: { id: planetId }, data: { id: updatedPlanetId } })
      assert.equal(await prisma.planetRecruitment.count({ where: { planetId } }), 0)
      assert.equal(await prisma.planetRecruitment.count({ where: { planetId: updatedPlanetId } }), 3)
    })
  } finally {
    try { await cleanupOwners(prisma, [ownerId]) } finally {
      await directClient.end()
      await prisma.$disconnect()
    }
  }
})

async function gameplayRows(prisma, ownerId) {
  const planetRows = await prisma.planet.findMany({ where: { ownerId }, orderBy: { id: "asc" } })
  const where = { planetId: { in: planetRows.map(({ id }) => id) } }
  return {
    planets: planetRows,
    orders: await prisma.planetRecruitment.findMany({ where, orderBy: { id: "asc" } }),
    constructions: await prisma.planetConstruction.findMany({ where, orderBy: { id: "asc" } }),
    materialLedger: await prisma.planetMaterialTransaction.findMany({ where, orderBy: { id: "asc" } }),
    stacks: await prisma.planetUnitStack.findMany({ where, orderBy: [{ planetId: "asc" }, { unitKey: "asc" }] }),
    unitLedger: await prisma.planetUnitTransaction.findMany({ where, orderBy: { id: "asc" } }),
  }
}

async function prepareStarter(prisma, ownerId) {
  const planetId = await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma })
  const planet = await prisma.planet.update({ where: { id: planetId }, data: { materials: 1000n, materialsProductionRemainder: 1234n } })
  const step = getInfrastructureStep("barracks", 1)
  const completesAt = new Date((await databaseTime(prisma)).getTime() - 1000)
  await prisma.planetConstruction.create({ data: {
    id: `fixture-barracks-${randomUUID()}`, planetId, buildingKey: "barracks", fromLevel: 0, targetLevel: 1,
    materialsCost: step.materialsCost, startedAt: new Date(completesAt.getTime() - step.durationSeconds * 1000), completesAt,
  } })
  return planet
}

function startIntent(planet) {
  return { ownerId: planet.ownerId, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch, quantity: "1", operationKey: randomUUID() }
}

function collectIntent(planet, orderId) {
  return { ownerId: planet.ownerId, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch, orderId }
}

async function readyOrder(prisma, id) {
  const order = await prisma.planetRecruitment.findUnique({ where: { id } })
  const completesAt = new Date((await databaseTime(prisma)).getTime() - 1)
  await prisma.planetRecruitment.update({ where: { id }, data: {
    startedAt: new Date(completesAt.getTime() - (order.completesAt.getTime() - order.startedAt.getTime())), completesAt,
  } })
}

function gatedUserLockClient(prisma) {
  let lockedResolve
  let releaseResolve
  const locked = new Promise((resolve) => { lockedResolve = resolve })
  const released = new Promise((resolve) => { releaseResolve = resolve })
  return {
    locked, release: () => releaseResolve(),
    client: { $transaction: (run) => prisma.$transaction((transaction) => run(new Proxy(transaction, {
      get(target, property) {
        if (property === "$queryRaw") return async (...args) => {
          const rows = await target.$queryRaw(...args)
          if (args[0].join("").includes('FROM "user"')) { lockedResolve(); await released }
          return rows
        }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    }))) },
  }
}

test("local recruitment reset atomically deletes history, preserves auth and invalidates reused starter forms", async (t) => {
  const prisma = await verifiedLocalPrisma()
  const ownerId = `recruitment-reset-${randomUUID()}`
  const otherOwnerId = `recruitment-other-${randomUUID()}`
  const ownerIds = [ownerId, otherOwnerId]
  const verificationId = `recruitment-verification-${randomUUID()}`
  const reset = (prismaClient = prisma) => resetCivilizationForUser({ userId: ownerId, confirmation: RESET_CIVILIZATION_CONFIRMATION, prismaClient })
  const start = (input, prismaClient = prisma) => startPlanetRecruitmentForOwner({ ...input, prismaClient })
  const collect = (input, prismaClient = prisma) => collectPlanetRecruitmentForOwner({ ...input, prismaClient })
  async function authRows() {
    const user = await prisma.user.findUnique({ where: { id: ownerId } })
    return {
      user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, image: user.image, createdAt: user.createdAt },
      accounts: await prisma.account.findMany({ where: { userId: ownerId }, orderBy: { id: "asc" } }),
      sessions: await prisma.session.findMany({ where: { userId: ownerId }, orderBy: { id: "asc" } }),
      verification: await prisma.verification.findUnique({ where: { id: verificationId } }),
    }
  }
  try {
    await prisma.user.createMany({ data: ownerIds.map((id) => ({ id, name: "Synthetic recruitment reset owner", email: `${id}@example.invalid`, factionKey: FACTION })) })
    await prisma.account.create({ data: { id: randomUUID(), accountId: ownerId, providerId: "credential", userId: ownerId, password: "synthetic-password-hash" } })
    await prisma.session.create({ data: { id: randomUUID(), token: randomUUID(), userId: ownerId, expiresAt: new Date("2099-01-01") } })
    await prisma.verification.create({ data: { id: verificationId, identifier: `${ownerId}@example.invalid`, value: "synthetic-verification-value", expiresAt: new Date("2099-01-01") } })
    const authBefore = await authRows()
    const original = await prepareStarter(prisma, ownerId)
    const other = await prepareStarter(prisma, otherOwnerId)
    const oldStart = startIntent(original)
    const first = await start(oldStart)
    await readyOrder(prisma, first.order.id)
    const oldCollect = collectIntent(original, first.order.id)
    await collect(oldCollect)
    await start(startIntent(original))
    await start(startIntent(other))
    const otherBefore = await gameplayRows(prisma, otherOwnerId)

    await t.test("failure after every gameplay deletion restores collected and pending orders with both ledgers", async () => {
      const before = await gameplayRows(prisma, ownerId)
      assert.equal(before.orders.length, 2)
      assert.equal(before.orders.filter(({ collectedAt }) => collectedAt === null).length, 1)
      let deleted = false
      const failingClient = { $transaction: (run) => prisma.$transaction((transaction) => run(new Proxy(transaction, {
        get(target, property) {
          if (property === "user") return { updateMany: async () => {
            assert.equal(await transaction.planet.count({ where: { ownerId } }), 0)
            assert.equal(await transaction.planetRecruitment.count({ where: { planetId: original.id } }), 0)
            assert.equal(await transaction.planetUnitTransaction.count({ where: { planetId: original.id } }), 0)
            deleted = true
            throw new Error("Synthetic failure after reset deletes")
          } }
          const value = Reflect.get(target, property)
          return typeof value === "function" ? value.bind(target) : value
        },
      }))) }
      await assert.rejects(reset(failingClient), { message: CIVILIZATION_RESET_ERROR })
      assert.equal(deleted, true)
      assert.deepEqual(await gameplayRows(prisma, ownerId), before)
      assert.deepEqual(await authRows(), authBefore)
      assert.deepEqual(await gameplayRows(prisma, otherOwnerId), otherBefore)
    })

    await t.test("successful reset preserves identities and rejects old start and collected-order replay after ID reuse", async () => {
      await reset()
      assert.deepEqual(await gameplayRows(prisma, ownerId), { planets: [], orders: [], constructions: [], materialLedger: [], stacks: [], unitLedger: [] })
      assert.equal((await prisma.user.findUnique({ where: { id: ownerId } })).factionKey, null)
      assert.deepEqual(await authRows(), authBefore)
      assert.deepEqual(await gameplayRows(prisma, otherOwnerId), otherBefore)
      await selectFactionForUser({ userId: ownerId, factionKey: "draskyr-clans", prismaClient: prisma })
      assert.equal(await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma }), original.id)
      const fresh = await prisma.planet.findUnique({ where: { id: original.id } })
      assert.notEqual(fresh.infrastructureEpoch, original.infrastructureEpoch)
      const before = await gameplayRows(prisma, ownerId)
      await assert.rejects(start(oldStart), { code: "stale-civilization" })
      await assert.rejects(collect(oldCollect), { code: "stale-civilization" })
      assert.deepEqual(await gameplayRows(prisma, ownerId), before)
      await reset()
    })

    for (const operation of ["start", "collect"]) for (const resetFirst of [false, true]) {
      await t.test(`${operation} and reset serialize when ${resetFirst ? "reset" : operation} holds User first`, async () => {
        await selectFactionForUser({ userId: ownerId, factionKey: "draskyr-clans", prismaClient: prisma })
        const planet = await prepareStarter(prisma, ownerId)
        const input = startIntent(planet)
        let collection
        if (operation === "collect") {
          const result = await start(input)
          await readyOrder(prisma, result.order.id)
          collection = collectIntent(planet, result.order.id)
        }
        const mutate = (client = prisma) => operation === "start" ? start(input, client) : collect(collection, client)
        const gate = gatedUserLockClient(prisma)
        const first = resetFirst ? reset(gate.client) : mutate(gate.client)
        let results
        try {
          await gate.locked
          const second = resetFirst ? mutate() : reset()
          gate.release()
          results = await Promise.allSettled([first, second])
        } finally {
          gate.release()
        }
        assert.equal(results[0].status, "fulfilled")
        assert.equal(results[1].status, resetFirst ? "rejected" : "fulfilled")
        if (resetFirst) assert.equal(results[1].reason.code, "not-owned")
        assert.deepEqual(await gameplayRows(prisma, ownerId), { planets: [], orders: [], constructions: [], materialLedger: [], stacks: [], unitLedger: [] })
        assert.equal((await prisma.user.findUnique({ where: { id: ownerId } })).factionKey, null)
        assert.deepEqual(await authRows(), authBefore)
        assert.deepEqual(await gameplayRows(prisma, otherOwnerId), otherBefore)
        await selectFactionForUser({ userId: ownerId, factionKey: "draskyr-clans", prismaClient: prisma })
        assert.equal(await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma }), planet.id)
        await assert.rejects(start(input), { code: "stale-civilization" })
        if (collection) await assert.rejects(collect(collection), { code: "stale-civilization" })
        await reset()
      })
    }
  } finally {
    try {
      await cleanupOwners(prisma, ownerIds)
      await prisma.verification.deleteMany({ where: { id: verificationId } })
    } finally { await prisma.$disconnect() }
  }
})
