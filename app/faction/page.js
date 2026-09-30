import Link from "next/link"

import { getAuthenticatedFaction } from "../../lib/authenticated-faction.js"
import { getPlanetaryFactionSummaries } from "../../lib/planetary-units.js"
import { selectFactionAction } from "./actions.js"

export const metadata = {
  title: "Faction | Projekt_space",
}

export default async function FactionPage({ searchParams }) {
  const faction = await getAuthenticatedFaction()
  const query = await searchParams

  if (faction !== null) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="faction-title">
          <div className="auth-heading">
            <p className="eyebrow">Civilization</p>
            <h1 id="faction-title">Your faction</h1>
            <p>
              {faction.name} applies to your full civilization and cannot be
              changed directly.
            </p>
            {query?.error === "selection" ? (
              <p className="form-message" role="alert">
                Unable to select a different faction.
              </p>
            ) : null}
          </div>

          <nav className="civilization-navigation" aria-label="Civilization navigation">
            <Link className="secondary-link" href={`/units/${faction.key}`}>
              View the nine-unit codex
            </Link>
            <Link className="secondary-link" href="/planets">
              View planets
            </Link>
            <Link className="danger-link" href="/civilization/reset">
              Reset civilization
            </Link>
          </nav>
        </section>
      </main>
    )
  }

  const factions = getPlanetaryFactionSummaries()
  const hasSelectionError = query?.error === "selection"

  return (
    <main className="codex-page">
      <div className="codex-shell">
        <header className="codex-header">
          <p className="eyebrow">Civilization</p>
          <h1>Choose your faction</h1>
          <p>
            This choice applies to your entire account. It remains permanent
            until you reset the civilization and remove its gameplay progress.
          </p>
          {hasSelectionError ? (
            <p className="form-message" role="alert">
              Unable to select the faction.
            </p>
          ) : null}
        </header>

        <section className="codex-section" aria-labelledby="faction-choices-title">
          <div className="codex-section-heading">
            <h2 id="faction-choices-title">Faction choices</h2>
            <p>Compare each faction&apos;s two unique planetary units before choosing.</p>
          </div>
          <div className="faction-grid">
            {factions.map((choice) => (
              <article className="faction-card faction-choice-card" key={choice.key}>
                <h3>{choice.name}</h3>
                <p className="faction-unique-label">Unique planetary units</p>
                <ul>
                  {choice.uniqueUnitNames.map((unitName) => (
                    <li key={unitName}>{unitName}</li>
                  ))}
                </ul>
                <div className="faction-choice-actions">
                  <Link className="secondary-link" href={`/units/${choice.key}`}>
                    View Unit Codex
                  </Link>
                  <form action={selectFactionAction}>
                    <input name="factionKey" type="hidden" value={choice.key} />
                    <button className="primary-button" type="submit">
                      Select {choice.name}
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
