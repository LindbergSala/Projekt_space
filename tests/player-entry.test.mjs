import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"

import {
  resolveAuthenticatedUserId,
  resolveOptionalAuthenticatedUserId,
} from "../lib/auth-session-policy.js"
import {
  PLAYER_ENTRY_ERROR,
  queryPlayerEntryDestinationForUser,
  resolvePlayerEntryDestination,
} from "../lib/player-entry-policy.js"
import {
  CIVILIZATION_RESET_ERROR,
  RESET_CIVILIZATION_CONFIRMATION,
  resetCivilizationForUser,
} from "../lib/civilization-policy.js"
import { getPlanetaryFactionSummaries } from "../lib/planetary-units.js"
import { parseCompatibleDatabaseUrl } from "../scripts/setup-local-db-role.mjs"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const SESSION_ERROR = "Authenticated session is missing a valid user ID."
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

  const url = new URL(databaseUrl)
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.port, "55432")
  assert.equal(url.pathname, "/projekt_space_dev")
  assert.equal(url.username, "projekt_space_app")
  assert.equal(url.search, "")
  assert.equal(url.hash, "")

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

async function taskSnapshot(prisma, { userIds, planetIds, verificationId }) {
  return {
    users: await prisma.user.findMany({
      where: { id: { in: userIds } },
      orderBy: { id: "asc" },
    }),
    accounts: await prisma.account.findMany({
      where: { userId: { in: userIds } },
      orderBy: { id: "asc" },
    }),
    sessions: await prisma.session.findMany({
      where: { userId: { in: userIds } },
      orderBy: { id: "asc" },
    }),
    verifications: await prisma.verification.findMany({
      where: { id: verificationId },
      orderBy: { id: "asc" },
    }),
    planets: await prisma.planet.findMany({
      where: { id: { in: planetIds } },
      orderBy: { id: "asc" },
    }),
    materialTransactions: await prisma.planetMaterialTransaction.findMany({
      where: { planetId: { in: planetIds } },
      orderBy: { id: "asc" },
    }),
    unitStacks: await prisma.planetUnitStack.findMany({
      where: { planetId: { in: planetIds } },
      orderBy: [{ planetId: "asc" }, { unitKey: "asc" }],
    }),
    unitTransactions: await prisma.planetUnitTransaction.findMany({
      where: { planetId: { in: planetIds } },
      orderBy: { id: "asc" },
    }),
  }
}

test("optional session returns null or the exact verified user ID", async () => {
  const calls = []
  const requestHeaders = new Headers({ "x-entry-test": "expected" })

  assert.equal(
    await resolveOptionalAuthenticatedUserId({
      getRequestHeaders: async () => {
        calls.push("headers")
        return requestHeaders
      },
      getSession: async ({ headers }) => {
        calls.push(headers.get("x-entry-test"))
        return null
      },
    }),
    null,
  )

  const userId = await resolveOptionalAuthenticatedUserId({
    getRequestHeaders: async () => requestHeaders,
    getSession: async ({ headers }) => {
      assert.equal(headers, requestHeaders)
      return {
        user: { id: "exact-user-id", name: "Never returned" },
        session: { id: "never-return-session", token: "never-return-token" },
      }
    },
  })

  assert.equal(userId, "exact-user-id")
  assert.equal(typeof userId, "string")
  assert.deepEqual(calls, ["headers", "expected"])
})

test("optional session fails closed for every malformed authenticated ID", async () => {
  const invalidUsers = [
    undefined,
    {},
    { id: undefined },
    { id: null },
    { id: "" },
    { id: "   " },
    { id: " padded-id " },
    { id: 123 },
  ]

  for (const user of invalidUsers) {
    await assert.rejects(
      resolveOptionalAuthenticatedUserId({
        getRequestHeaders: async () => new Headers(),
        getSession: async () => ({
          user,
          session: { id: "never-log-session", token: "never-log-token" },
        }),
      }),
      { message: SESSION_ERROR },
    )
  }

  const policy = await source("lib/auth-session-policy.js")
  assert.doesNotMatch(policy, /console\.|\.token/u)
})

test("required session identity keeps its existing redirect and validation behavior", async () => {
  const destinations = []
  assert.equal(
    await resolveAuthenticatedUserId({
      getRequestHeaders: async () => new Headers(),
      getSession: async () => null,
      redirectUnauthenticated(destination) {
        destinations.push(destination)
        return "redirected"
      },
    }),
    "redirected",
  )
  assert.deepEqual(destinations, ["/login"])

  await assert.rejects(
    resolveAuthenticatedUserId({
      getRequestHeaders: async () => new Headers(),
      getSession: async () => ({ user: { id: " invalid " } }),
      redirectUnauthenticated() {
        throw new Error("unexpected redirect")
      },
    }),
    { message: SESSION_ERROR },
  )
})

test("pure entry policy returns only canonical fixed destinations", () => {
  const factions = getPlanetaryFactionSummaries()
  assert.equal(
    resolvePlayerEntryDestination({
      factionKey: null,
      hasOwnedPlanet: false,
    }),
    "/faction",
  )

  const destinations = new Set(["/faction"])
  for (const faction of factions) {
    const withoutPlanet = resolvePlayerEntryDestination({
      factionKey: faction.key,
      hasOwnedPlanet: false,
    })
    const withPlanet = resolvePlayerEntryDestination({
      factionKey: faction.key,
      hasOwnedPlanet: true,
    })
    assert.equal(withoutPlanet, "/planets")
    assert.equal(withPlanet, "/civilization")
    destinations.add(withoutPlanet)
    destinations.add(withPlanet)
  }
  assert.deepEqual(
    [...destinations].sort(),
    ["/civilization", "/faction", "/planets"],
  )

  for (const factionKey of [undefined, "unknown", " orthevan-directorate"] ) {
    assert.throws(
      () => resolvePlayerEntryDestination({ factionKey, hasOwnedPlanet: false }),
      { message: PLAYER_ENTRY_ERROR },
    )
  }
  for (const hasOwnedPlanet of [undefined, null, 0, "false"]) {
    assert.throws(
      () => resolvePlayerEntryDestination({ factionKey: null, hasOwnedPlanet }),
      { message: PLAYER_ENTRY_ERROR },
    )
  }
})

test("entry query selects only the matching faction and first owned planet", async () => {
  let receivedQuery
  assert.equal(
    await queryPlayerEntryDestinationForUser({
      userId: "authenticated-user",
      userModel: {
        async findUnique(query) {
          receivedQuery = query
          return {
            factionKey: "orthevan-directorate",
            ownedPlanets: [{ id: "planet-a" }],
          }
        },
      },
    }),
    "/civilization",
  )
  assert.deepEqual(receivedQuery, {
    where: { id: "authenticated-user" },
    select: {
      factionKey: true,
      ownedPlanets: {
        select: { id: true },
        orderBy: { id: "asc" },
        take: 1,
      },
    },
  })

  await assert.rejects(
    queryPlayerEntryDestinationForUser({
      userId: "authenticated-user",
      userModel: { async findUnique() { return null } },
    }),
    { message: PLAYER_ENTRY_ERROR },
  )
  await assert.rejects(
    queryPlayerEntryDestinationForUser({
      userId: "authenticated-user",
      userModel: {
        async findUnique() {
          return { factionKey: "invalid-faction", ownedPlanets: [] }
        },
      },
    }),
    { message: PLAYER_ENTRY_ERROR },
  )

  const policy = await source("lib/player-entry-policy.js")
  assert.doesNotMatch(
    policy,
    /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/u,
  )
})

test("root is a dynamic Server Component with one server-side redirect authority", async () => {
  const page = await source("app/page.js")
  const operation = await source("lib/authenticated-player-entry.js")

  assert.doesNotMatch(page, /^["']use client["']/mu)
  assert.doesNotMatch(page, /useEffect|useRouter|window|document|localStorage|sessionStorage/u)
  assert.doesNotMatch(page, /fetch\(|api\//u)
  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(page, /export default async function Home\(\)/u)
  assert.match(
    page,
    /const destination = await getAuthenticatedPlayerEntryDestination\(\)/u,
  )
  assert.equal((page.match(/redirect\(destination\)/gu) ?? []).length, 1)
  assert.doesNotMatch(page, /try\s*\{|catch\s*[({]/u)
  assert.match(page, />PROJECT_SPACE</u)
  assert.match(page, />A persistent interstellar strategy game\.<\/p>/u)
  assert.match(page, /Establish your faction, command planets, and build a civilization\./u)
  assert.equal((page.match(/<Link /gu) ?? []).length, 2)
  assert.match(page, /href="\/login">Log in<\/Link>/u)
  assert.match(page, /href="\/register">Create account<\/Link>/u)

  assert.match(operation, /^import "server-only"$/mu)
  assert.match(
    operation,
    /export async function getAuthenticatedPlayerEntryDestination\(\)/u,
  )
  assert.match(operation, /await getOptionalAuthenticatedUserId\(\)/u)
  assert.match(operation, /if \(userId === null\) \{\s*return null/u)
  assert.doesNotMatch(
    operation,
    /request|searchParams|params|formData|FormData|cookies|localStorage|sessionStorage/u,
  )
  await assert.rejects(access(path.join(ROOT_DIRECTORY, "app/route.js")))
})

test("auth completion routes through root and account links back once", async () => {
  const login = await source("app/login/login-form.js")
  const registration = await source("app/register/register-form.js")
  const account = await source("app/account/page.js")

  for (const form of [login, registration]) {
    assert.match(form, /onSuccess\(\) \{\s*router\.replace\("\/"\);\s*router\.refresh\(\);/u)
    assert.doesNotMatch(form, /router\.replace\("\/(?:account|faction|planets|civilization)"\)/u)
    assert.doesNotMatch(form, /searchParams|callbackURL|callbackUrl|window\.location/u)
  }
  assert.equal((account.match(/href="\/"/gu) ?? []).length, 1)
  assert.match(account, />\s*Return to game\s*<\/Link>/u)
})

test("local entry lifecycle is owner-isolated, read-only, and fully cleaned up", async () => {
  const prisma = localPrismaClient()
  const testId = randomUUID()
  const userId = `entry-user-${testId}`
  const otherUserId = `entry-other-${testId}`
  const userIds = [userId, otherUserId]
  const planetId = `entry-planet-${testId}`
  const otherPlanetId = `entry-other-planet-${testId}`
  const planetIds = [planetId, otherPlanetId]
  const accountId = `entry-account-${testId}`
  const sessionId = `entry-session-${testId}`
  const verificationId = `entry-verification-${testId}`
  let baseline

  try {
    const [identity] = await prisma.$queryRaw`
      SELECT current_database() AS database_name,
             current_user AS user_name,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port
    `
    assert.equal(identity.database_name, "projekt_space_dev")
    assert.equal(identity.user_name, "projekt_space_app")
    assert.equal(identity.server_port, 5432)
    baseline = await rowCounts(prisma)

    await prisma.user.createMany({
      data: [
        {
          id: userId,
          name: "Entry User",
          email: `${userId}@example.invalid`,
        },
        {
          id: otherUserId,
          name: "Entry Other",
          email: `${otherUserId}@example.invalid`,
          factionKey: "zhyreth-brood",
        },
      ],
    })
    await prisma.account.create({
      data: {
        id: accountId,
        accountId: userId,
        providerId: "credential",
        userId,
        password: "synthetic-hashed-password",
      },
    })
    await prisma.session.create({
      data: {
        id: sessionId,
        token: `entry-token-${testId}`,
        userId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    })
    await prisma.verification.create({
      data: {
        id: verificationId,
        identifier: `${userId}@example.invalid`,
        value: "synthetic-verification-value",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    })
    await prisma.planet.create({
      data: { id: otherPlanetId, ownerId: otherUserId, materials: 7n },
    })

    let before = await taskSnapshot(prisma, { userIds, planetIds, verificationId })
    assert.equal(
      await queryPlayerEntryDestinationForUser({
        userId,
        userModel: prisma.user,
      }),
      "/faction",
    )
    assert.deepEqual(
      await taskSnapshot(prisma, { userIds, planetIds, verificationId }),
      before,
    )

    await prisma.user.update({
      where: { id: userId },
      data: { factionKey: "orthevan-directorate" },
    })
    before = await taskSnapshot(prisma, { userIds, planetIds, verificationId })
    assert.equal(
      await queryPlayerEntryDestinationForUser({
        userId,
        userModel: prisma.user,
      }),
      "/planets",
    )
    assert.equal(
      await queryPlayerEntryDestinationForUser({
        userId: otherUserId,
        userModel: prisma.user,
      }),
      "/civilization",
    )
    assert.deepEqual(
      await taskSnapshot(prisma, { userIds, planetIds, verificationId }),
      before,
    )

    await prisma.planet.create({
      data: { id: planetId, ownerId: userId, materials: 11n },
    })
    await prisma.planetMaterialTransaction.create({
      data: {
        id: `entry-material-${testId}`,
        planetId,
        delta: 11n,
        balanceAfter: 11n,
      },
    })
    await prisma.planetUnitStack.create({
      data: { planetId, unitKey: "line-infantry", quantity: 3n },
    })
    await prisma.planetUnitTransaction.create({
      data: {
        id: `entry-unit-${testId}`,
        planetId,
        unitKey: "line-infantry",
        delta: 3n,
        quantityAfter: 3n,
      },
    })
    before = await taskSnapshot(prisma, { userIds, planetIds, verificationId })
    assert.equal(
      await queryPlayerEntryDestinationForUser({
        userId,
        userModel: prisma.user,
      }),
      "/civilization",
    )
    assert.deepEqual(
      await taskSnapshot(prisma, { userIds, planetIds, verificationId }),
      before,
    )

    await resetCivilizationForUser({
      userId,
      confirmation: RESET_CIVILIZATION_CONFIRMATION,
      prismaClient: prisma,
    })
    before = await taskSnapshot(prisma, { userIds, planetIds, verificationId })
    assert.equal(
      await queryPlayerEntryDestinationForUser({
        userId,
        userModel: prisma.user,
      }),
      "/faction",
    )
    assert.deepEqual(
      await taskSnapshot(prisma, { userIds, planetIds, verificationId }),
      before,
    )
  } finally {
    await prisma.planetUnitTransaction.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planetUnitStack.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planetMaterialTransaction.deleteMany({
      where: { planetId: { in: planetIds } },
    }).catch(() => {})
    await prisma.planet.deleteMany({
      where: { id: { in: planetIds } },
    }).catch(() => {})
    await prisma.session.deleteMany({
      where: { userId: { in: userIds } },
    }).catch(() => {})
    await prisma.account.deleteMany({
      where: { userId: { in: userIds } },
    }).catch(() => {})
    await prisma.verification.deleteMany({
      where: { id: verificationId },
    }).catch(() => {})
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    }).catch(() => {})

    if (baseline !== undefined) {
      assert.deepEqual(await rowCounts(prisma), baseline)
    }
    await prisma.$disconnect()
  }
})

test("reset policy retains its fixed error contract", () => {
  assert.equal(CIVILIZATION_RESET_ERROR, "Unable to reset the civilization.")
})
