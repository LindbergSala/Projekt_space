import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import test from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { startPlanetConstructionForOwner } from "../lib/infrastructure-construction-policy.js"
import { getInfrastructureStep } from "../lib/planet-infrastructure.js"
import {
  RECRUITMENT_MESSAGES,
  RecruitmentError,
  collectPlanetRecruitmentForOwner,
  readStrictRecruitmentCollect,
  readStrictRecruitmentStart,
  startPlanetRecruitmentForOwner,
} from "../lib/planet-recruitment-policy.js"
import { applyPlanetUnitTransactionForOwner } from "../lib/planet-unit-transactions-policy.js"
import { getPlanetaryFactionSummaries } from "../lib/planetary-units.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const FACTIONS = getPlanetaryFactionSummaries().map(({ key }) => key)
const MAXIMUM = 9_223_372_036_854_775_807n
const NOW = new Date("2026-10-02T12:00:00.123Z")

function intent(overrides = {}) {
  return {
    planetId: "planet-owned", infrastructureEpoch: "11111111-1111-4111-8111-111111111111",
    quantity: "1", operationKey: "22222222-2222-4222-8222-222222222222", ...overrides,
  }
}

function orderId(ownerId = "owner", operationKey = intent().operationKey) {
  return `recruitment_${createHash("sha256").update("projekt-space/planet-recruitment/v1\0").update(ownerId).update("\0").update(operationKey).digest("hex")}`
}

function collectIntent(overrides = {}) {
  const { planetId, infrastructureEpoch } = intent()
  return { planetId, infrastructureEpoch, orderId: orderId(), ...overrides }
}

function form(input) {
  const value = new FormData()
  for (const [key, field] of Object.entries(input)) value.append(key, field)
  return value
}

function hasCode(code) {
  return (error) => {
    assert.ok(error instanceof RecruitmentError)
    assert.equal(error.code, code)
    assert.equal(error.message, RECRUITMENT_MESSAGES[code])
    return true
  }
}

function barracks({ planetId = "planet-owned", completesAt = new Date(NOW.getTime() - 1) } = {}) {
  const step = getInfrastructureStep("barracks", 1)
  return {
    id: `fixture-barracks-${randomUUID()}`, planetId, buildingKey: "barracks", fromLevel: 0, targetLevel: 1,
    materialsCost: step.materialsCost,
    startedAt: new Date(completesAt.getTime() - step.durationSeconds * 1000), completesAt,
  }
}

test("recruitment forms accept only intent fields and ignore string framework metadata", () => {
  for (const [parser, input] of [[readStrictRecruitmentStart, intent()], [readStrictRecruitmentCollect, collectIntent()]]) {
    const valid = form(input)
    for (const field of ["$ACTION_ID_synthetic", "$ACTION_ownerId", "$ACTION_unitKey", "$ACTION_materialsCost", "$ACTION_quantity"]) valid.append(field, "untrusted")
    assert.deepEqual(parser(valid), input)
    const invalid = [null, {}, new FormData()]
    for (const key of Object.keys(input)) {
      const duplicate = form(input)
      duplicate.append(key, input[key])
      invalid.push(duplicate)
      const missing = form(input)
      missing.delete(key)
      invalid.push(missing)
      const file = form(input)
      file.set(key, new File(["synthetic"], "synthetic.txt"))
      invalid.push(file)
    }
    for (const key of ["ownerId", "factionKey", "materialsCost", "unitKey", "startedAt", "completesAt", "collectedAt", "$ACTION", "$action_synthetic"]) {
      const extra = form(input)
      extra.append(key, "untrusted")
      invalid.push(extra)
    }
    const file = form(input)
    file.append("$ACTION_file", new File(["synthetic"], "synthetic.txt"))
    invalid.push(file)
    for (const value of invalid) assert.throws(() => parser(value), hasCode("invalid"))
  }
  for (const quantity of ["", "0", "01", "+1", "-1", "1.0", "1e1", " 1", "1 ", "1\n", "١", (MAXIMUM + 1n).toString(), "9".repeat(1000)]) {
    assert.throws(() => readStrictRecruitmentStart(form(intent({ quantity }))), hasCode("invalid"))
  }
  for (const [key, values] of Object.entries({
    planetId: ["", " padded", "padded ", "x".repeat(129)],
    infrastructureEpoch: ["", "invalid", "11111111-1111-4111-8111-11111111111A"],
    operationKey: ["", "invalid", "22222222-2222-4222-8222-22222222222A"],
  })) for (const value of values) assert.throws(() => readStrictRecruitmentStart(form(intent({ [key]: value }))), hasCode("invalid"))
  for (const orderId of ["", "other", `recruitment_${"A".repeat(64)}`, `recruitment_${"a".repeat(63)}`]) {
    assert.throws(() => readStrictRecruitmentCollect(form(collectIntent({ orderId }))), hasCode("invalid"))
  }
})

test("recruitment start locks User then owned Planet before reading database time and atomically saves fixed terms", async () => {
  const events = []
  let savedOrder
  const request = intent({ quantity: "10" })
  const result = await startPlanetRecruitmentForOwner({
    ...request, ownerId: "owner", unitKey: "heavy-tank", factionKey: "untrusted", materialsCost: 0n,
    prismaClient: {
      async $transaction(run) {
        return run({
          async $queryRaw(strings, ...values) {
            const sql = strings.join("?")
            if (sql.includes('FROM "user"')) { events.push("user-lock"); assert.deepEqual(values, ["owner"]); return [{ factionKey: FACTIONS[0] }] }
            if (sql.includes('FROM "planet"')) { events.push("planet-lock"); assert.deepEqual(values, [request.planetId, "owner"]); return [{ id: request.planetId, materials: MAXIMUM, infrastructureEpoch: request.infrastructureEpoch }] }
            events.push("database-time")
            assert.match(sql, /clock_timestamp\(\)/u)
            return [{ currentTime: NOW }]
          },
          planetRecruitment: {
            async findUnique({ where }) { events.push("retry"); assert.equal(where.id, orderId()); return null },
            async findFirst() { return null },
            async create({ data }) { events.push("order"); savedOrder = data; return { id: data.id } },
          },
          planetConstruction: { async findMany() { return [barracks()] } },
          planetUnitStack: { async findUnique() { return { quantity: 9_007_199_254_740_993n } } },
          planet: {
            async updateMany({ where, data }) {
              events.push("debit")
              assert.equal(where.ownerId, "owner")
              assert.equal(where.infrastructureEpoch, request.infrastructureEpoch)
              assert.equal(data.materials, MAXIMUM - 100n)
              return { count: 1 }
            },
          },
          planetMaterialTransaction: {
            async create({ data }) {
              events.push("material-ledger")
              assert.equal(data.id, `materials_${orderId()}`)
              assert.equal(data.delta, -100n)
              assert.equal(data.balanceAfter, MAXIMUM - 100n)
              assert.deepEqual(data.createdAt, NOW)
              return { id: data.id }
            },
          },
        })
      },
    },
  })
  assert.deepEqual(events, ["user-lock", "planet-lock", "retry", "database-time", "debit", "order", "material-ledger"])
  assert.equal(savedOrder.unitKey, "line-infantry")
  assert.equal(savedOrder.quantity, 10n)
  assert.equal(savedOrder.materialsCost, 100n)
  assert.equal(savedOrder.completesAt.getTime() - savedOrder.startedAt.getTime(), 3_000_000)
  assert.equal(savedOrder.collectedAt, null)
  assert.equal(result.balanceAfter, (MAXIMUM - 100n).toString())
  assert.equal(result.replayed, false)
  assert.doesNotThrow(() => JSON.stringify(result))
})

test("collect accepts the saved exact completion millisecond and never starts a nested transaction", async () => {
  const saved = {
    id: orderId(), planetId: "planet-owned", unitKey: "line-infantry", quantity: 1n, materialsCost: 10n,
    startedAt: new Date(NOW.getTime() - 300_000), completesAt: NOW, collectedAt: null,
  }
  for (const offset of [-1, 0, 1]) {
    const writes = []
    const clock = new Date(NOW.getTime() + offset)
    const prismaClient = { async $transaction(run) {
      return run({
        async $queryRaw(strings) {
          const sql = strings.join("?")
          if (sql.includes('FROM "user"')) return [{ factionKey: FACTIONS[0] }]
          if (sql.includes('FROM "planet"')) return [{ id: saved.planetId, materials: 90n, infrastructureEpoch: intent().infrastructureEpoch }]
          return [{ currentTime: clock }]
        },
        planetRecruitment: {
          async findFirst({ where }) { assert.deepEqual(where, { id: saved.id, planetId: saved.planetId }); return saved },
          async updateMany({ where, data }) { writes.push("collected"); assert.equal(where.collectedAt, null); assert.deepEqual(data.collectedAt, clock); return { count: 1 } },
        },
        planetUnitStack: {
          async findUnique() { return { quantity: 9_007_199_254_740_993n } },
          async upsert({ update, create }) { writes.push("stack"); assert.equal(update.quantity, 9_007_199_254_740_994n); assert.equal(create.unitKey, "line-infantry"); return update },
        },
        planetUnitTransaction: {
          async findUnique() { return null },
          async create({ data }) { writes.push("unit-ledger"); assert.equal(data.delta, 1n); assert.deepEqual(data.createdAt, clock); return data },
        },
      })
    } }
    const run = collectPlanetRecruitmentForOwner({ ...collectIntent(), ownerId: "owner", prismaClient })
    if (offset < 0) {
      await assert.rejects(run, hasCode("not-ready"))
      assert.deepEqual(writes, [])
    } else {
      const result = await run
      assert.equal(result.replayed, false)
      assert.equal(result.order.collectedAt, clock.toISOString())
      assert.deepEqual(writes, ["stack", "unit-ledger", "collected"])
    }
  }
})

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

test("local PostgreSQL recruitment transactions preserve payment, delivery and independent queues", async (t) => {
  const prisma = await verifiedLocalPrisma()
  const suffix = randomUUID()
  const owners = [...FACTIONS, null].map((_, index) => `recruitment-owner-${index}-${suffix}`)
  const planets = []
  async function databaseTime() {
    const [{ currentTime }] = await prisma.$queryRaw`SELECT clock_timestamp() AS "currentTime"`
    return currentTime
  }
  async function createPlanet({ faction = 0, materials = 1000n, completedBarracks = true } = {}) {
    const id = `recruitment-planet-${randomUUID()}`
    planets.push(id)
    const planet = await prisma.planet.create({ data: { id, ownerId: owners[faction], materials } })
    if (completedBarracks) await prisma.planetConstruction.create({ data: barracks({ planetId: id, completesAt: new Date((await databaseTime()).getTime() - 1000) }) })
    return planet
  }
  function request(planet, overrides = {}) {
    return { ownerId: planet.ownerId, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch, quantity: "1", operationKey: randomUUID(), prismaClient: prisma, ...overrides }
  }
  function collection(planet, id, overrides = {}) {
    return { ownerId: planet.ownerId, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch, orderId: id, prismaClient: prisma, ...overrides }
  }
  async function rows(planetId) {
    return {
      planet: await prisma.planet.findUnique({ where: { id: planetId } }),
      orders: await prisma.planetRecruitment.findMany({ where: { planetId }, orderBy: { id: "asc" } }),
      constructions: await prisma.planetConstruction.findMany({ where: { planetId }, orderBy: { id: "asc" } }),
      materialLedger: await prisma.planetMaterialTransaction.findMany({ where: { planetId }, orderBy: { id: "asc" } }),
      stacks: await prisma.planetUnitStack.findMany({ where: { planetId }, orderBy: { unitKey: "asc" } }),
      unitLedger: await prisma.planetUnitTransaction.findMany({ where: { planetId }, orderBy: { id: "asc" } }),
    }
  }
  async function makeReady(id) {
    const order = await prisma.planetRecruitment.findUnique({ where: { id } })
    const completesAt = new Date((await databaseTime()).getTime() - 1)
    // Synthetic persisted fixture retains the complete accepted duration.
    return prisma.planetRecruitment.update({ where: { id }, data: {
      startedAt: new Date(completesAt.getTime() - (order.completesAt.getTime() - order.startedAt.getTime())), completesAt,
    } })
  }
  function failingClient(delegate, method, inspect) {
    return { $transaction(run) {
      return prisma.$transaction((transaction) => run(new Proxy(transaction, {
        get(target, property) {
          if (property !== delegate) return Reflect.get(target, property)
          return new Proxy(transaction[delegate], { get(model, operation) {
            if (operation !== method) return Reflect.get(model, operation)
            return async () => { await inspect(transaction); throw new Error("Synthetic internal failure must remain private") }
          } })
        },
      })))
    } }
  }
  try {
    await prisma.user.createMany({ data: owners.map((id, index) => ({
      id, name: "Synthetic recruitment owner", email: `${id}@example.invalid`, factionKey: FACTIONS[index] ?? null,
    })) })

    await t.test("all factions pay fixed exact terms without creating units at start", async () => {
      for (let faction = 0; faction < FACTIONS.length; faction += 1) {
        const quantity = faction % 2 === 0 ? 1n : 10n
        const planet = await createPlanet({ faction, materials: 9_007_199_254_740_993n })
        const result = await startPlanetRecruitmentForOwner(request(planet, { quantity: quantity.toString() }))
        const saved = await rows(planet.id)
        assert.equal(result.replayed, false)
        assert.equal(saved.planet.materials, planet.materials - quantity * 10n)
        assert.deepEqual(saved.planet.materialsProductionCursor, planet.materialsProductionCursor)
        assert.equal(saved.planet.materialsProductionRemainder, planet.materialsProductionRemainder)
        assert.equal(saved.orders.length, 1)
        assert.equal(saved.orders[0].quantity, quantity)
        assert.equal(saved.orders[0].unitKey, "line-infantry")
        assert.equal(saved.orders[0].materialsCost, quantity * 10n)
        assert.equal(saved.orders[0].completesAt.getTime() - saved.orders[0].startedAt.getTime(), Number(quantity) * 300_000)
        assert.equal(saved.materialLedger.length, 1)
        assert.equal(saved.materialLedger[0].delta, -quantity * 10n)
        assert.equal(saved.materialLedger[0].balanceAfter, saved.planet.materials)
        assert.deepEqual(saved.stacks, [])
        assert.deepEqual(saved.unitLedger, [])
      }
    })

    await t.test("completed Barracks and stored Materials are required; invalid quantities never mutate", async () => {
      const absent = await createPlanet({ completedBarracks: false })
      let before = await rows(absent.id)
      await assert.rejects(startPlanetRecruitmentForOwner(request(absent)), hasCode("barracks-required"))
      assert.deepEqual(await rows(absent.id), before)
      const now = await databaseTime()
      await prisma.planetConstruction.create({ data: barracks({ planetId: absent.id, completesAt: new Date(now.getTime() + 60_000) }) })
      before = await rows(absent.id)
      await assert.rejects(startPlanetRecruitmentForOwner(request(absent)), hasCode("barracks-required"))
      assert.deepEqual(await rows(absent.id), before)
      const poor = await createPlanet({ materials: 9n })
      await prisma.planet.update({ where: { id: poor.id }, data: { materialsProductionCursor: new Date(now.getTime() - 72 * 3_600_000) } })
      before = await rows(poor.id)
      await assert.rejects(startPlanetRecruitmentForOwner(request(poor)), hasCode("insufficient-materials"))
      for (const quantity of ["0", "01", "1.0", "+1", "1e2", " 1", 1, 1n, null]) {
        await assert.rejects(startPlanetRecruitmentForOwner(request(poor, { quantity })), hasCode("invalid"))
      }
      assert.deepEqual(await rows(poor.id), before)
    })

    await t.test("missing and foreign objects are indistinguishable; faction and epoch gate fresh requests and replay", async () => {
      const planet = await createPlanet()
      const another = await createPlanet({ faction: 1 })
      const factionless = await createPlanet({ faction: 4 })
      const intent = request(planet)
      const result = await startPlanetRecruitmentForOwner(intent)
      const before = await rows(planet.id)
      await assert.rejects(startPlanetRecruitmentForOwner({ ...intent, ownerId: another.ownerId }), hasCode("not-owned"))
      await assert.rejects(startPlanetRecruitmentForOwner({ ...intent, planetId: "missing-planet" }), hasCode("not-owned"))
      await assert.rejects(startPlanetRecruitmentForOwner(request(factionless)), hasCode("faction-required"))
      await assert.rejects(startPlanetRecruitmentForOwner({ ...intent, infrastructureEpoch: randomUUID() }), hasCode("stale-civilization"))
      for (const input of [
        collection(planet, result.order.id, { ownerId: another.ownerId }),
        collection(planet, result.order.id, { planetId: "missing-planet" }),
        collection(another, result.order.id),
        collection(planet, orderId("missing", randomUUID())),
      ]) await assert.rejects(collectPlanetRecruitmentForOwner(input), hasCode("not-owned"))
      await assert.rejects(collectPlanetRecruitmentForOwner(collection(planet, result.order.id, { infrastructureEpoch: randomUUID() })), hasCode("stale-civilization"))
      await prisma.user.update({ where: { id: planet.ownerId }, data: { factionKey: null } })
      try {
        await assert.rejects(startPlanetRecruitmentForOwner(intent), hasCode("faction-required"))
        await assert.rejects(collectPlanetRecruitmentForOwner(collection(planet, result.order.id)), hasCode("faction-required"))
      } finally {
        await prisma.user.update({ where: { id: planet.ownerId }, data: { factionKey: FACTIONS[0] } })
      }
      assert.deepEqual(await rows(planet.id), before)
    })

    await t.test("quantity, cost, date and resulting stock overflow fail before debit", async () => {
      const planet = await createPlanet({ materials: MAXIMUM })
      const before = await rows(planet.id)
      for (const quantity of [MAXIMUM.toString(), (MAXIMUM / 10n).toString(), "30000000000", "1000000000"]) {
        await assert.rejects(startPlanetRecruitmentForOwner(request(planet, { quantity })), hasCode("capacity"))
      }
      assert.deepEqual(await rows(planet.id), before)
      await prisma.planetUnitStack.create({ data: { planetId: planet.id, unitKey: "line-infantry", quantity: MAXIMUM } })
      const full = await rows(planet.id)
      await assert.rejects(startPlanetRecruitmentForOwner(request(planet)), hasCode("capacity"))
      assert.deepEqual(await rows(planet.id), full)
    })

    await t.test("concurrent exact starts debit once, conflicting keys fail, and other planets recruit independently", async () => {
      const planet = await createPlanet()
      const other = await createPlanet()
      const input = request(planet, { quantity: "10" })
      const results = await Promise.all([startPlanetRecruitmentForOwner(input), startPlanetRecruitmentForOwner(input)])
      assert.deepEqual(results.map(({ replayed }) => replayed).sort(), [false, true])
      assert.deepEqual(results[0].order, results[1].order)
      const before = await rows(planet.id)
      assert.equal(before.planet.materials, 900n)
      assert.equal(before.materialLedger.length, 1)
      await assert.rejects(startPlanetRecruitmentForOwner({ ...input, quantity: "1" }), hasCode("conflict"))
      await assert.rejects(startPlanetRecruitmentForOwner({ ...input, planetId: other.id, infrastructureEpoch: other.infrastructureEpoch }), hasCode("conflict"))
      assert.deepEqual(await rows(planet.id), before)
      const [otherResult, replay] = await Promise.all([startPlanetRecruitmentForOwner(request(other)), startPlanetRecruitmentForOwner(input)])
      assert.equal(otherResult.replayed, false)
      assert.equal(replay.replayed, true)
      assert.ok(Date.parse(otherResult.order.startedAt) < Date.parse(results[0].order.completesAt))
      const competing = await createPlanet()
      const attempts = await Promise.allSettled([startPlanetRecruitmentForOwner(request(competing)), startPlanetRecruitmentForOwner(request(competing))])
      assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1)
      hasCode("busy")(attempts.find(({ status }) => status === "rejected").reason)
      assert.equal((await rows(competing.id)).materialLedger.length, 1)
    })

    await t.test("construction and recruitment run concurrently and serialize their shared Materials budget", async () => {
      function construction(planet) {
        return { ownerId: planet.ownerId, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch, buildingKey: "materials-extractor", expectedLevel: 0, operationKey: randomUUID(), prismaClient: prisma }
      }
      const rich = await createPlanet({ materials: 20n })
      const accepted = await Promise.all([startPlanetRecruitmentForOwner(request(rich)), startPlanetConstructionForOwner(construction(rich))])
      assert.equal(accepted.every(({ replayed }) => !replayed), true)
      const saved = await rows(rich.id)
      assert.equal(saved.planet.materials, 0n)
      assert.equal(saved.orders.length, 1)
      assert.equal(saved.constructions.length, 2)
      assert.equal(saved.materialLedger.length, 2)
      const poor = await createPlanet({ materials: 10n })
      const race = await Promise.allSettled([startPlanetRecruitmentForOwner(request(poor)), startPlanetConstructionForOwner(construction(poor))])
      assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1)
      assert.equal(race.find(({ status }) => status === "rejected").reason.code, "insufficient-materials")
      const after = await rows(poor.id)
      assert.equal(after.planet.materials, 0n)
      assert.equal(after.materialLedger.length, 1)
      assert.equal(after.orders.length + after.constructions.length, 2)
    })

    await t.test("Ready occupies its slot; concurrent delivery and another unit operation lose no updates", async () => {
      const planet = await createPlanet()
      const input = request(planet, { quantity: "10" })
      const started = await startPlanetRecruitmentForOwner(input)
      const before = await rows(planet.id)
      await assert.rejects(collectPlanetRecruitmentForOwner(collection(planet, started.order.id)), hasCode("not-ready"))
      assert.deepEqual(await rows(planet.id), before)
      const savedOrder = await makeReady(started.order.id)
      await assert.rejects(startPlanetRecruitmentForOwner(request(planet)), hasCode("busy"))
      const readyRetry = await startPlanetRecruitmentForOwner(input)
      assert.equal(readyRetry.replayed, true)
      assert.equal(readyRetry.order.completesAt, savedOrder.completesAt.toISOString())
      const [first, second] = await Promise.all([
        collectPlanetRecruitmentForOwner(collection(planet, started.order.id)),
        collectPlanetRecruitmentForOwner(collection(planet, started.order.id)),
        applyPlanetUnitTransactionForOwner({ ownerId: planet.ownerId, planetId: planet.id, unitKey: "line-infantry", delta: 3n, operationKey: `independent-${randomUUID()}`, prismaClient: prisma }),
      ])
      assert.deepEqual([first.replayed, second.replayed].sort(), [false, true])
      const after = await rows(planet.id)
      assert.equal(after.stacks[0].quantity, 13n)
      assert.equal(after.materialLedger.length, 1)
      assert.equal(after.unitLedger.length, 2)
      assert.equal(after.unitLedger.filter(({ delta }) => delta === 10n).length, 1)
      assert.ok(after.orders[0].collectedAt >= after.orders[0].completesAt)
      const replay = await startPlanetRecruitmentForOwner(input)
      assert.equal(replay.replayed, true)
      assert.equal((await collectPlanetRecruitmentForOwner(collection(planet, started.order.id))).replayed, true)
      assert.deepEqual(await rows(planet.id), after)
      const next = await startPlanetRecruitmentForOwner(request(planet))
      assert.notEqual(next.order.id, started.order.id)
      assert.equal(next.replayed, false)
      assert.equal((await rows(planet.id)).orders.length, 2)
      assert.equal((await startPlanetRecruitmentForOwner(input)).replayed, true)
    })

    await t.test("saved accepted price and duration survive retry and collection without current-rule recalculation", async () => {
      const planet = await createPlanet()
      const input = request(planet)
      const { order } = await startPlanetRecruitmentForOwner(input)
      const completesAt = new Date((await databaseTime()).getTime() - 1)
      // A synthetic older accepted quote keeps its order, balance and payment
      // ledger consistent while differing from the current registry's terms.
      await prisma.$transaction(async (transaction) => {
        await transaction.planetRecruitment.update({ where: { id: order.id }, data: {
          materialsCost: 17n, startedAt: new Date(completesAt.getTime() - 600_000), completesAt,
        } })
        await transaction.planet.update({ where: { id: planet.id }, data: { materials: planet.materials - 17n } })
        await transaction.planetMaterialTransaction.update({ where: { id: `materials_${order.id}` }, data: {
          delta: -17n, balanceAfter: planet.materials - 17n,
        } })
      })
      const before = await rows(planet.id)
      const retried = await startPlanetRecruitmentForOwner(input)
      assert.equal(retried.order.materialsCost, "17")
      assert.equal(retried.order.durationSeconds, "600")
      assert.deepEqual(await rows(planet.id), before)
      await collectPlanetRecruitmentForOwner(collection(planet, order.id))
      const after = await rows(planet.id)
      assert.equal(after.stacks[0].quantity, 1n)
      assert.equal(after.materialLedger.length, 1)
      assert.equal(after.planet.materials, before.planet.materials)
    })

    await t.test("collect rechecks stock capacity after another unit transaction and leaves the paid order pending", async () => {
      const planet = await createPlanet()
      const { order } = await startPlanetRecruitmentForOwner(request(planet))
      await makeReady(order.id)
      await applyPlanetUnitTransactionForOwner({ ownerId: planet.ownerId, planetId: planet.id, unitKey: "line-infantry", delta: MAXIMUM, operationKey: `full-${randomUUID()}`, prismaClient: prisma })
      const before = await rows(planet.id)
      await assert.rejects(collectPlanetRecruitmentForOwner(collection(planet, order.id)), hasCode("capacity"))
      assert.deepEqual(await rows(planet.id), before)
    })

    await t.test("start failures after debit and order insertion roll back all writes and sanitize errors", async () => {
      for (const [delegate, method] of [["planetRecruitment", "create"], ["planetMaterialTransaction", "create"]]) {
        const planet = await createPlanet()
        const before = await rows(planet.id)
        let inspected = false
        const prismaClient = failingClient(delegate, method, async (transaction) => {
          assert.equal((await transaction.planet.findUnique({ where: { id: planet.id } })).materials, 990n)
          assert.equal(await transaction.planetRecruitment.count({ where: { planetId: planet.id } }), delegate === "planetRecruitment" ? 0 : 1)
          inspected = true
        })
        await assert.rejects(startPlanetRecruitmentForOwner(request(planet, { prismaClient })), hasCode("unavailable"))
        assert.equal(inspected, true)
        assert.deepEqual(await rows(planet.id), before)
      }
    })

    await t.test("delivery failures after stack and ledger writes roll back the complete collect", async () => {
      for (const [delegate, method] of [["planetUnitTransaction", "create"], ["planetRecruitment", "updateMany"]]) {
        const planet = await createPlanet()
        const { order } = await startPlanetRecruitmentForOwner(request(planet, { quantity: "10" }))
        await makeReady(order.id)
        const before = await rows(planet.id)
        let inspected = false
        const prismaClient = failingClient(delegate, method, async (transaction) => {
          assert.equal((await transaction.planetUnitStack.findUnique({ where: { planetId_unitKey: { planetId: planet.id, unitKey: "line-infantry" } } })).quantity, 10n)
          assert.equal(await transaction.planetUnitTransaction.count({ where: { planetId: planet.id } }), delegate === "planetUnitTransaction" ? 0 : 1)
          inspected = true
        })
        await assert.rejects(collectPlanetRecruitmentForOwner(collection(planet, order.id, { prismaClient })), hasCode("unavailable"))
        assert.equal(inspected, true)
        assert.deepEqual(await rows(planet.id), before)
      }
    })
  } finally {
    try {
      const where = { planetId: { in: planets } }
      await prisma.planetRecruitment.deleteMany({ where })
      await prisma.planetConstruction.deleteMany({ where })
      await prisma.planetUnitTransaction.deleteMany({ where })
      await prisma.planetUnitStack.deleteMany({ where })
      await prisma.planetMaterialTransaction.deleteMany({ where })
      await prisma.planet.deleteMany({ where: { id: { in: planets } } })
      await prisma.user.deleteMany({ where: { id: { in: owners } } })
    } finally {
      await prisma.$disconnect()
    }
  }
})
