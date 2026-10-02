import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"
import { resetCivilizationForUser, readStrictResetConfirmation, RESET_CIVILIZATION_CONFIRMATION, CIVILIZATION_RESET_ERROR } from "../lib/civilization-policy.js"
import { selectFactionForUser } from "../lib/faction-policy.js"
import { ensureStarterPlanetForOwner } from "../lib/starter-planet-policy.js"
import { startPlanetConstructionForOwner } from "../lib/infrastructure-construction-policy.js"
import { queryOwnedPlanetDetailForOwner } from "../lib/owned-planets-query.js"

test("reset form accepts framework metadata without relaxing confirmation validation", () => {
  const valid = new FormData()
  valid.set("confirmation", RESET_CIVILIZATION_CONFIRMATION)
  valid.set("$ACTION_ID_synthetic", "")
  valid.set("$ACTION_userId", "another-owner")
  assert.equal(readStrictResetConfirmation(valid), RESET_CIVILIZATION_CONFIRMATION)
  for (const [name, value] of [["confirmation", RESET_CIVILIZATION_CONFIRMATION], ["ownerId", "other"], ["$ACTION_file", new File(["x"], "x.txt")]]) {
    const invalid = new FormData()
    for (const entry of valid) invalid.append(...entry)
    invalid.append(name, value)
    assert.throws(() => readStrictResetConfirmation(invalid), { message: CIVILIZATION_RESET_ERROR })
  }
})

test("local infrastructure reset removes future effects, survives races, and invalidates reused starter forms", async () => {
  parseCompatibleDatabaseUrl(process.env.DATABASE_URL)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const ownerId = `infra-reset-${randomUUID()}`
  const otherOwnerId = `infra-other-${randomUUID()}`
  const ownerIds = [ownerId, otherOwnerId]
  const reset = (client = prisma) => resetCivilizationForUser({ userId: ownerId, confirmation: RESET_CIVILIZATION_CONFIRMATION, prismaClient: client })
  const start = (intent) => startPlanetConstructionForOwner({ ...intent, prismaClient: prisma })
  const intentFor = (planet, owner = ownerId) => ({ ownerId: owner, planetId: planet.id, infrastructureEpoch: planet.infrastructureEpoch, buildingKey: "materials-extractor", expectedLevel: 0, operationKey: randomUUID() })
  try {
    await prisma.user.createMany({ data: ownerIds.map((id) => ({ id, name: "Synthetic reset player", email: `${id}@example.invalid`, factionKey: "orthevan-directorate" })) })
    await prisma.account.create({ data: { id: randomUUID(), accountId: ownerId, providerId: "credential", userId: ownerId, password: "synthetic-hash" } })
    await prisma.session.create({ data: { id: randomUUID(), token: randomUUID(), userId: ownerId, expiresAt: new Date("2099-01-01") } })
    const planetId = await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma })
    const otherId = await ensureStarterPlanetForOwner({ ownerId: otherOwnerId, prismaClient: prisma })
    const original = await prisma.planet.update({ where: { id: planetId }, data: { materials: 1000n, materialsProductionRemainder: 1234n } })
    const other = await prisma.planet.update({ where: { id: otherId }, data: { materials: 1000n } })
    const oldIntent = intentFor(original)
    await start(oldIntent)
    await start(intentFor(other, otherOwnerId))
    const otherBefore = await prisma.planet.findUnique({ where: { id: otherId }, include: { constructions: true, materialTransactions: true } })
    const oldRows = await prisma.planet.findUnique({ where: { id: planetId }, include: { constructions: true, materialTransactions: true } })

    // Fail after all gameplay deletes to prove reset rolls every dependent row back.
    await assert.rejects(reset({
      $transaction: (run) => prisma.$transaction((transaction) => run(new Proxy(transaction, {
        get(target, property) {
          if (property === "user") return { updateMany: async () => { throw new Error("Synthetic reset rollback probe") } }
          const value = target[property]
          return typeof value === "function" ? value.bind(target) : value
        },
      }))),
    }), { message: CIVILIZATION_RESET_ERROR })
    assert.deepEqual(await prisma.planet.findUnique({ where: { id: planetId }, include: { constructions: true, materialTransactions: true } }), oldRows)

    await reset()
    assert.equal(await prisma.planetConstruction.count({ where: { planetId } }), 0)
    assert.equal(await prisma.planetMaterialTransaction.count({ where: { planetId } }), 0)
    assert.equal(await prisma.account.count({ where: { userId: ownerId } }), 1)
    assert.equal(await prisma.session.count({ where: { userId: ownerId } }), 1)
    assert.deepEqual(await prisma.planet.findUnique({ where: { id: otherId }, include: { constructions: true, materialTransactions: true } }), otherBefore)

    await selectFactionForUser({ userId: ownerId, factionKey: "draskyr-clans", prismaClient: prisma })
    assert.equal(await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma }), planetId)
    const fresh = await prisma.planet.findUnique({ where: { id: planetId } })
    assert.notEqual(fresh.infrastructureEpoch, original.infrastructureEpoch)
    assert.equal(fresh.materials, 0n)
    assert.equal(fresh.materialsProductionRemainder, 0n)
    const detail = await queryOwnedPlanetDetailForOwner({ planetId, ownerId, prismaClient: prisma })
    assert.deepEqual(detail.infrastructure.buildings.map(({ level }) => level), [1, 0, 0, 0, 0])
    assert.equal(detail.infrastructure.activeConstruction, null)
    assert.equal(detail.production.ratePerHour, "10")
    await assert.rejects(start(oldIntent), { code: "stale-civilization" })

    // Exercise both lock acquisition orders: build then reset; reset then build.
    for (const resetFirst of [false, true]) {
      await prisma.planet.update({ where: { id: planetId }, data: { materials: 1000n } })
      const planet = await prisma.planet.findUnique({ where: { id: planetId } })
      let signalLocked
      let releaseLock
      const locked = new Promise((resolve) => { signalLocked = resolve })
      const released = new Promise((resolve) => { releaseLock = resolve })
      const delayedClient = {
        $transaction: (run) => prisma.$transaction((transaction) => run(new Proxy(transaction, {
          get(target, property) {
            if (property === "$queryRaw") return async (...args) => {
              const rows = await target.$queryRaw(...args)
              if (args[0].join("").includes('FROM "user"')) { signalLocked(); await released }
              return rows
            }
            const value = target[property]
            return typeof value === "function" ? value.bind(target) : value
          },
        }))),
      }
      const intent = intentFor(planet)
      const first = resetFirst ? reset(delayedClient) : startPlanetConstructionForOwner({ ...intent, prismaClient: delayedClient })
      await locked
      const second = resetFirst ? start(intent) : reset()
      releaseLock()
      const results = await Promise.allSettled([first, second])
      assert.equal(results[0].status, "fulfilled")
      assert.equal(results[1].status, resetFirst ? "rejected" : "fulfilled")
      assert.equal(await prisma.planet.count({ where: { ownerId } }), 0)
      assert.equal(await prisma.planetConstruction.count({ where: { planetId } }), 0)
      assert.equal(await prisma.planetMaterialTransaction.count({ where: { planetId } }), 0)
      assert.equal((await prisma.user.findUnique({ where: { id: ownerId } })).factionKey, null)
      await selectFactionForUser({ userId: ownerId, factionKey: "draskyr-clans", prismaClient: prisma })
      await ensureStarterPlanetForOwner({ ownerId, prismaClient: prisma })
      await assert.rejects(start(intent), { code: "stale-civilization" })
    }
    assert.deepEqual(await prisma.planet.findUnique({ where: { id: otherId }, include: { constructions: true, materialTransactions: true } }), otherBefore)
  } finally {
    const where = { planet: { ownerId: { in: ownerIds } } }
    await prisma.planetConstruction.deleteMany({ where })
    await prisma.planetMaterialTransaction.deleteMany({ where })
    await prisma.planet.deleteMany({ where: { ownerId: { in: ownerIds } } })
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } })
    await prisma.$disconnect()
  }
})
