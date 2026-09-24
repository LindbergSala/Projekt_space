import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

test("/planets uses the parameterless authenticated planets operation", async () => {
  const page = await source("app/planets/page.js")

  assert.doesNotMatch(page, /^["']use client["']/mu)
  assert.match(
    page,
    /import \{ getAuthenticatedUserPlanets \} from ["']\.\.\/\.\.\/lib\/owned-planets\.js["']/u,
  )
  assert.match(page, /export default async function PlanetsPage\(\)/u)
  assert.match(
    page,
    /const planets = await getAuthenticatedUserPlanets\(\)/u,
  )
  assert.equal((page.match(/getAuthenticatedUserPlanets\(/gu) ?? []).length, 1)
  assert.doesNotMatch(page, /prisma|fetch\(|api\//u)
})

test("/planets renders only the returned planet names and IDs", async () => {
  const page = await source("app/planets/page.js")

  assert.match(page, /planets\.map\(\(planet\) =>/u)
  assert.match(page, /key=\{planet\.id\}/u)
  assert.match(page, /\{planet\.name\}/u)
  assert.match(page, /\{planet\.id\}/u)
  assert.doesNotMatch(
    page,
    /planet\.(?:owner|ownerId|coordinates|resources|faction|units)/u,
  )
})

test("/planets renders a clear empty state", async () => {
  const page = await source("app/planets/page.js")

  assert.match(page, /planets\.length === 0/u)
  assert.match(page, />You do not have any planets yet\.<\/p>/u)
})

test("/planets preserves the deterministic order returned by the operation", async () => {
  const page = await source("app/planets/page.js")
  const query = await source("lib/owned-planets-query.js")

  assert.match(query, /orderBy: \{ id: ["']asc["'] \}/u)
  assert.match(query, /select: \{ id: true, name: true \}/u)
  assert.match(page, /planets\.map\(\(planet\) =>/u)
  assert.doesNotMatch(page, /\.sort\(/u)
})

test("/planets accepts no owner identity from client-controlled data", async () => {
  const page = await source("app/planets/page.js")
  const operation = await source("lib/owned-planets.js")

  assert.doesNotMatch(
    page,
    /ownerId|userId|searchParams|params|formData|FormData|request|cookies|localStorage|sessionStorage/u,
  )
  assert.match(
    operation,
    /const ownerId = await requireAuthenticatedUserId\(\)/u,
  )
  assert.doesNotMatch(
    operation,
    /searchParams|params|formData|FormData|request|localStorage|sessionStorage/u,
  )
})

test("account retains name and email while linking to /planets", async () => {
  const page = await source("app/account/page.js")

  assert.match(page, /const user = await requireAuthenticatedUser\(\)/u)
  assert.match(page, /<dt>Name<\/dt>\s*<dd>\{user\.name\}<\/dd>/u)
  assert.match(page, /<dt>Email<\/dt>\s*<dd>\{user\.email\}<\/dd>/u)
  assert.match(page, /href=["']\/planets["']/u)
  assert.doesNotMatch(page, /user\.id|ownerId|sessionId|accountId|token/u)
})
