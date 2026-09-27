import Link from "next/link"

import { requireAuthenticatedUser } from "../../lib/auth-session.js"
import {
  getGeneralPlanetaryUnits,
  getPlanetaryFactionSummaries,
  getPlanetaryRosterForFaction,
} from "../../lib/planetary-units.js"
import UnitCard from "./unit-card.js"

export const metadata = {
  title: "Planetary Unit Codex | Projekt_space",
}

export default async function UnitsPage() {
  await requireAuthenticatedUser()

  const generalUnits = getGeneralPlanetaryUnits()
  const factions = getPlanetaryFactionSummaries()

  return (
    <main className="codex-page">
      <div className="codex-shell">
        <header className="codex-header">
          <p className="eyebrow">Military Reference</p>
          <h1>Planetary Unit Codex</h1>
          <p>
            All factions share seven general planetary units. Each faction
            adds two unique units to form a complete nine-unit reference
            roster.
          </p>
        </header>

        <section className="codex-section" aria-labelledby="general-units-title">
          <div className="codex-section-heading">
            <h2 id="general-units-title">General planetary units</h2>
            <p>These seven definitions are shared by every faction.</p>
          </div>
          <div className="unit-grid">
            {generalUnits.map((unit) => (
              <UnitCard key={unit.key} unit={unit} />
            ))}
          </div>
        </section>

        <section className="codex-section" aria-labelledby="faction-rosters-title">
          <div className="codex-section-heading">
            <h2 id="faction-rosters-title">Faction rosters</h2>
            <p>
              Explore each faction&apos;s two unique additions to the shared
              general roster.
            </p>
          </div>
          <div className="faction-grid">
            {factions.map((faction) => {
              const roster = getPlanetaryRosterForFaction(faction.key)

              return (
                <article className="faction-card" key={faction.key}>
                  <h3>{faction.name}</h3>
                  <p>{roster.length} units in the complete roster</p>
                  <p className="faction-unique-label">Unique units</p>
                  <ul>
                    {faction.uniqueUnitNames.map((unitName) => (
                      <li key={unitName}>{unitName}</li>
                    ))}
                  </ul>
                  <Link
                    className="secondary-link faction-roster-link"
                    href={`/units/${faction.key}`}
                  >
                    View {faction.name} roster
                  </Link>
                </article>
              )
            })}
          </div>
        </section>

        <nav className="codex-navigation" aria-label="Codex navigation">
          <Link className="secondary-link" href="/planets">
            Back to planets
          </Link>
        </nav>
      </div>
    </main>
  )
}
