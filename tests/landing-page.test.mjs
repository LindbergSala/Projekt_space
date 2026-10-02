import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { getPlanetaryFactionSummaries } from "../lib/planetary-units.js"

const ROOT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

async function source(relativePath) {
  return readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")
}

test("landing route preserves the canonical server-side player entry boundary", async () => {
  const page = await source("app/page.js")

  assert.doesNotMatch(page, /^["']use client["']/mu)
  assert.doesNotMatch(
    page,
    /useEffect|useRouter|window|\bdocument\b|localStorage|sessionStorage|fetch\(|api\//u,
  )
  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(page, /export default async function Home\(\)/u)
  assert.equal(
    (page.match(/getAuthenticatedPlayerEntryDestination\(\)/gu) ?? []).length,
    1,
  )
  assert.equal((page.match(/redirect\(destination\)/gu) ?? []).length, 1)
  assert.doesNotMatch(
    page,
    /Home\s*\(\s*\{|searchParams|formData|FormData|userId|ownerId/u,
  )

  const redirectIndex = page.indexOf("redirect(destination)")
  assert.ok(redirectIndex > 0)
  assert.ok(
    redirectIndex <
      page.indexOf("const factions = getPlanetaryFactionSummaries()"),
  )
  assert.ok(redirectIndex < page.indexOf("return ("))
  await assert.rejects(access(path.join(ROOT_DIRECTORY, "app/route.js")))
})

test("landing page supplies metadata and a semantic, accessible document outline", async () => {
  const page = await source("app/page.js")

  assert.match(page, /export const metadata = \{/u)
  assert.match(page, /title: "PROJECT_SPACE \| Persistent interstellar strategy"/u)
  assert.match(
    page,
    /description:\s*"Choose a faction, establish your first planet, and begin a persistent interstellar civilization\."/u,
  )
  assert.equal((page.match(/<h1(?:\s|>)/gu) ?? []).length, 1)

  for (const element of ["header", "nav", "main", "section", "article", "footer"]) {
    assert.match(page, new RegExp(`<${element}(?:\\s|>)`, "u"))
  }

  assert.match(page, /className="landing-skip-link" href="#main-content"/u)
  assert.match(page, /<main id="main-content">/u)
  assert.match(page, /className="landing-orbit" aria-hidden="true"/u)

  for (const anchor of ["begin", "foundation", "factions", "horizon"]) {
    assert.match(page, new RegExp(`id="${anchor}"`, "u"))
    assert.match(page, new RegExp(`href="#${anchor}"`, "u"))
  }
})

test("landing page presents the complete current public journey", async () => {
  const page = await source("app/page.js")

  for (const copy of [
    "Build the command structure of a civilization.",
    "Your civilization begins here",
    "Choose your faction",
    "Establish your first planet",
    "Command your civilization",
    "Available foundation",
    "Account-wide faction",
    "Owned planets",
    "Exact Materials records",
    "Planetary forces",
    "Unit Codex",
    "Command Center",
    "Strategy horizon · Planned",
    "Begin your civilization.",
    "projekt-space.vercel.app",
  ]) {
    assert.ok(page.includes(copy), `Expected landing copy: ${copy}`)
  }

  assert.equal((page.match(/href="\/register"/gu) ?? []).length, 3)
  assert.equal((page.match(/href="\/login"/gu) ?? []).length, 3)
  assert.equal((page.match(/Create account/gu) ?? []).length, 3)
  assert.equal((page.match(/Log in/gu) ?? []).length, 3)
})

test("faction showcase is rendered from the canonical planetary registry", async () => {
  const page = await source("app/page.js")
  const factions = getPlanetaryFactionSummaries()

  assert.deepEqual(factions, [
    {
      key: "orthevan-directorate",
      name: "Orthevan Directorate",
      uniqueUnitNames: ["Vanguard Exosuit", "Siege Strider"],
    },
    {
      key: "zhyreth-brood",
      name: "Zhyreth Brood",
      uniqueUnitNames: ["Razor Beast", "Spore Caster"],
    },
    {
      key: "nhalorin-continuum",
      name: "Nhalorin Continuum",
      uniqueUnitNames: ["Aegis Construct", "Phase Reaper"],
    },
    {
      key: "draskyr-clans",
      name: "Draskyr Clans",
      uniqueUnitNames: ["Scrap Brute", "Rift Raider"],
    },
  ])
  assert.equal(factions.length, 4)
  assert.equal(factions.flatMap((faction) => faction.uniqueUnitNames).length, 8)
  assert.match(page, /import \{ getPlanetaryFactionSummaries \}/u)
  assert.match(page, /const factions = getPlanetaryFactionSummaries\(\)/u)
  assert.match(page, /factions\.map\(\(faction, index\) =>/u)
  assert.match(page, /faction\.uniqueUnitNames\.map\(\(unitName\) =>/u)

  for (const faction of factions) {
    assert.doesNotMatch(page, new RegExp(faction.name, "u"))
    for (const unitName of faction.uniqueUnitNames) {
      assert.doesNotMatch(page, new RegExp(unitName, "u"))
    }
  }
})

test("landing claims distinguish current planet progression from future systems", async () => {
  const page = await source("app/page.js")
  const availableCopy = page.slice(
    page.indexOf("const FOUNDATION_FEATURES"),
    page.indexOf("const STRATEGY_HORIZON"),
  )
  const plannedCopy = page.slice(
    page.indexOf("const STRATEGY_HORIZON"),
    page.indexOf("export default async function Home"),
  )

  assert.match(availableCopy, /Claim earned Materials/u)
  assert.match(availableCopy, /build or upgrade timed infrastructure that progresses offline/u)
  assert.match(availableCopy, /Recruit Line Infantry[\s\S]*collect it into your planet/u)
  assert.match(availableCopy, /Other unit and ship production remains planned/u)
  assert.doesNotMatch(
    availableCopy,
    /research|Fleets|transport|plunder|conquest|Alliances/u,
  )
  for (const plannedSystem of [
    "Research",
    "additional unit and ship production",
    "Fleets",
    "transport",
    "combat",
    "plunder",
    "conquest",
    "Alliances",
  ]) {
    assert.ok(plannedCopy.includes(plannedSystem))
  }
  assert.match(page, /They are planned work, not claims about the\s*currently playable foundation/u)
})

test("landing implementation is asset-free and contains no mutation surface", async () => {
  const page = await source("app/page.js")
  const css = await source("app/globals.css")

  assert.doesNotMatch(page, /https?:\/\//u)
  assert.doesNotMatch(page, /<img|<Image|<script|dangerouslySetInnerHTML|<form|action=/u)
  assert.doesNotMatch(
    page,
    /\.create\(|\.createMany\(|\.update\(|\.upsert\(|\.delete\(/u,
  )
  assert.doesNotMatch(css, /url\(\s*["']?https?:\/\//u)
  assert.doesNotMatch(css, /@keyframes/u)
})

test("landing styles are isolated, mobile-first, touch-safe, and responsive", async () => {
  const css = await source("app/globals.css")

  for (const selector of [
    ".landing-page",
    ".landing-header",
    ".landing-hero",
    ".landing-orbit",
    ".landing-step-grid",
    ".landing-feature-grid",
    ".landing-faction-grid",
    ".landing-horizon-grid",
    ".landing-footer",
  ]) {
    assert.ok(css.includes(selector), `Expected landing selector: ${selector}`)
  }

  assert.match(css, /\.landing-page \{[\s\S]*?overflow-x: hidden;/u)
  assert.match(css, /\.landing-button \{[\s\S]*?min-height: 2\.75rem;/u)
  assert.match(css, /\.landing-nav a,[\s\S]*?min-height: 2\.75rem;/u)
  assert.match(css, /@media \(min-width: 48rem\)/u)
  assert.match(css, /@media \(min-width: 70rem\)/u)
  assert.match(css, /\.landing-step-grid \{\s*grid-template-columns: repeat\(3,/u)
  assert.match(css, /\.landing-faction-grid,[\s\S]*?repeat\(4,/u)
})
