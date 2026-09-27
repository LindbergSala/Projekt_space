import Link from "next/link"
import { notFound } from "next/navigation"

import { requireAuthenticatedUser } from "../../../lib/auth-session.js"
import {
  getPlanetaryFaction,
  getPlanetaryRosterForFaction,
} from "../../../lib/planetary-units.js"
import UnitCard from "../unit-card.js"

export const metadata = {
  title: "Faction Unit Roster | Projekt_space",
}

export default async function FactionUnitsPage({ params }) {
  await requireAuthenticatedUser()

  const { factionKey } = await params
  const faction = getPlanetaryFaction(factionKey)
  const roster = getPlanetaryRosterForFaction(factionKey)

  if (faction === null || roster === null) {
    notFound()
  }

  const generalUnits = roster.filter((unit) => unit.scope === "general")
  const uniqueUnits = roster.filter((unit) => unit.scope === "faction")

  return (
    <main className="codex-page">
      <div className="codex-shell">
        <header className="codex-header">
          <p className="eyebrow">Faction Reference</p>
          <h1>{faction.name}</h1>
          <p>
            This canonical nine-unit reference roster does not indicate player
            ownership or a selected faction.
          </p>
        </header>

        <section className="codex-section" aria-labelledby="general-units-title">
          <div className="codex-section-heading">
            <h2 id="general-units-title">General planetary units</h2>
            <p>Seven gameplay definitions shared by every faction.</p>
          </div>
          <div className="unit-grid">
            {generalUnits.map((unit) => (
              <UnitCard key={unit.key} unit={unit} />
            ))}
          </div>
        </section>

        <section className="codex-section" aria-labelledby="unique-units-title">
          <div className="codex-section-heading">
            <h2 id="unique-units-title">Faction-unique units</h2>
            <p>Two definitions available only to {faction.name}.</p>
          </div>
          <div className="unit-grid">
            {uniqueUnits.map((unit) => (
              <UnitCard key={unit.key} unit={unit} />
            ))}
          </div>
        </section>

        <nav className="codex-navigation" aria-label="Codex navigation">
          <Link className="secondary-link" href="/units">
            Back to unit codex
          </Link>
          <Link className="secondary-link" href="/planets">
            Back to planets
          </Link>
        </nav>
      </div>
    </main>
  )
}
