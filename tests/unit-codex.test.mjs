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

test("both codex routes are authenticated database-free Server Components", async () => {
  const indexPage = await source("app/units/page.js")
  const factionPage = await source("app/units/[factionKey]/page.js")

  for (const page of [indexPage, factionPage]) {
    assert.doesNotMatch(page, /^["']use client["']/mu)
    assert.match(page, /await requireAuthenticatedUser\(\)/u)
    assert.doesNotMatch(
      page,
      /prisma|DATABASE_URL|owned-planets|fetch\(|api\/|user\.id|ownerId|sessionId|token/iu,
    )
    assert.doesNotMatch(page, /<form|<button|action=|useState|useEffect/u)
  }
})

test("/units renders the complete shared codex and four canonical faction links", async () => {
  const page = await source("app/units/page.js")

  assert.match(page, />Military Reference</u)
  assert.match(page, />Planetary Unit Codex</u)
  assert.match(page, />General planetary units</u)
  assert.match(page, />Faction rosters</u)
  assert.match(page, /generalUnits\.map\(\(unit\) =>/u)
  assert.match(page, /factions\.map\(\(faction\) =>/u)
  assert.match(page, /faction\.uniqueUnitNames\.map/u)
  assert.match(page, /getPlanetaryRosterForFaction\(faction\.key\)/u)
  assert.match(page, /href=\{`\/units\/\$\{faction\.key\}`\}/u)
  assert.match(page, /href="\/planets"/u)
})

test("faction route strictly validates params, calls notFound, and preserves canonical sections", async () => {
  const page = await source("app/units/[factionKey]/page.js")

  assert.match(page, /const \{ factionKey \} = await params/u)
  assert.match(page, /getPlanetaryFaction\(factionKey\)/u)
  assert.match(page, /getPlanetaryRosterForFaction\(factionKey\)/u)
  assert.match(page, /faction === null \|\| roster === null/u)
  assert.match(page, /notFound\(\)/u)
  assert.doesNotMatch(page, /toLowerCase|toUpperCase|trim\(|decodeURIComponent/u)
  assert.match(page, /unit\.scope === "general"/u)
  assert.match(page, /unit\.scope === "faction"/u)
  assert.ok(page.indexOf("generalUnits.map") < page.indexOf("uniqueUnits.map"))
  assert.match(page, />\s*Back to unit codex\s*</u)
  assert.match(page, />\s*Back to planets\s*</u)
  assert.match(page, /does not indicate player\s+ownership or a selected faction/su)
})

test("unit cards render complete descriptions with semantic battlefield-role lists", async () => {
  const card = await source("app/units/unit-card.js")

  assert.match(card, /\{unit\.name\}/u)
  assert.match(card, /\{unit\.category\}/u)
  assert.match(card, /\{unit\.primaryFunction\}/u)
  assert.match(card, /<ul className="unit-role-list">/u)
  assert.match(card, /unit\.battlefieldRoles\.map\(\(role\) =>/u)
  assert.match(card, /<li key=\{role\}>\{role\}<\/li>/u)
  assert.match(card, /unit\.designPrinciple/u)
  assert.match(card, /unit\.uniqueRole/u)
  assert.doesNotMatch(card, /owner|quantity|cost|productionTime|attack|defen[cs]e|health|speed/iu)
})

test("planet detail links the selected faction codex without removing existing behavior", async () => {
  const page = await source("app/planets/[planetId]/page.js")

  assert.equal((page.match(/href="\/units"/gu) ?? []).length, 0)
  assert.match(
    page,
    /href=\{`\/units\/\$\{encodeURIComponent\(forces\.faction\.key\)\}`\}/u,
  )
  assert.match(page, /\{forces\.faction\.name\} Unit Codex/u)
  assert.match(page, /getAuthenticatedUserPlanetById\(planetId\)/u)
  assert.match(page, />Materials<\/dt>/u)
  assert.match(page, />Materials history<\/h2>/u)
  assert.match(page, /action=\{renamePlanetAction\}/u)
  assert.match(page, /href="\/planets"/u)
})

test("codex styling is mobile-first, responsive, and prevents narrow-content overflow", async () => {
  const css = await source("app/globals.css")

  assert.match(css, /\.codex-page\s*\{[^}]*overflow-x: hidden;/su)
  assert.match(css, /\.unit-card,[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/u)
  assert.match(css, /\.faction-roster-link\s*\{[^}]*width: 100%;/su)
  assert.match(
    css,
    /@media \(min-width: 48rem\)[\s\S]*?\.unit-grid,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u,
  )
})
