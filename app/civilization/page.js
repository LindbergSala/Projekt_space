import Link from "next/link"

import { getAuthenticatedCivilizationCommandCenter } from "../../lib/authenticated-civilization.js"
import { claimPlanetMaterialsProductionFromCommandCenterAction } from "./actions.js"
import ConstructionFeedback from "../planets/construction-feedback.js"
import { ConstructionFinishTime } from "../planets/planet-infrastructure.js"

export const metadata = {
  title: "Command Center | Projekt_space",
}

export const dynamic = "force-dynamic"

function signedDelta(delta) {
  return delta.startsWith("-") ? delta : `+${delta}`
}

export default async function CivilizationCommandCenterPage({ searchParams }) {
  const { construction } = await searchParams
  const civilization = await getAuthenticatedCivilizationCommandCenter()

  return (
    <main className="command-center-page">
      <div className="command-center-shell">
        <header className="command-center-header">
          <div>
            <p className="eyebrow">Civilization Command</p>
            <h1>Command Center</h1>
            <p className="command-center-faction">
              {civilization.faction.name}
            </p>
            <p>
              This is the current authoritative overview of your civilization,
              its worlds, resources, and planetary ground forces.
            </p>
          </div>
          <Link className="secondary-link" href="/faction">
            View faction
          </Link>
        </header>

        <ConstructionFeedback status={construction} />

        <section
          className="command-center-section"
          aria-labelledby="civilization-summary-title"
        >
          <div className="command-center-section-heading">
            <p className="eyebrow">Civilization status</p>
            <h2 id="civilization-summary-title">Summary</h2>
          </div>
          <dl className="command-center-summary">
            <div>
              <dt>Worlds</dt>
              <dd>{civilization.summary.planetCount}</dd>
            </div>
            <div>
              <dt>Stored Materials</dt>
              <dd>{civilization.summary.materials}</dd>
            </div>
            <div>
              <dt>Unclaimed Materials</dt>
              <dd>{civilization.summary.unclaimedMaterials}</dd>
            </div>
            <div>
              <dt>Materials production</dt>
              <dd>{civilization.summary.materialsProductionPerHour} / hour</dd>
            </div>
            <div>
              <dt>Ground forces</dt>
              <dd>{civilization.summary.groundForces}</dd>
            </div>
          </dl>
        </section>

        <section
          className="command-center-section"
          aria-labelledby="civilization-planets-title"
        >
          <div className="command-center-section-heading">
            <p className="eyebrow">Owned worlds</p>
            <h2 id="civilization-planets-title">Planets</h2>
          </div>
          {civilization.planets.length === 0 ? (
            <div className="command-center-empty">
              <p>You do not have any planets yet.</p>
              <Link className="primary-link" href="/planets">
                Open planets
              </Link>
            </div>
          ) : (
            <div className="command-center-planet-grid">
              {civilization.planets.map((planet) => (
                <article className="command-center-planet" key={planet.id}>
                  <div>
                    <h3>{planet.name}</h3>
                    <p className="command-center-planet-id">{planet.id}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Stored Materials</dt>
                      <dd>{planet.materials}</dd>
                    </div>
                    <div>
                      <dt>Production</dt>
                      <dd>{planet.production.ratePerHour} / hour</dd>
                    </div>
                    <div>
                      <dt>Available to claim</dt>
                      <dd>{planet.production.availableMaterials}</dd>
                    </div>
                    <div>
                      <dt>Ground forces</dt>
                      <dd>{planet.groundForces}</dd>
                    </div>
                    <div>
                      <dt>Occupied unit types</dt>
                      <dd>{planet.occupiedUnitTypes}</dd>
                    </div>
                  </dl>
                  {planet.infrastructure.activeConstruction ? (
                    <div className="command-center-construction">
                      <strong>
                        {planet.infrastructure.activeConstruction.buildingName}
                        {" · "}Level {planet.infrastructure.activeConstruction.targetLevel} in progress
                      </strong>
                      <p>
                        Finishes <ConstructionFinishTime value={planet.infrastructure.activeConstruction.completesAt} />.
                      </p>
                    </div>
                  ) : (
                    <p className="command-center-construction-idle">No construction in progress.</p>
                  )}
                  {planet.production.availableMaterials !== "0" ? (
                    <form
                      action={claimPlanetMaterialsProductionFromCommandCenterAction}
                      className="materials-production-claim"
                    >
                      <input name="planetId" type="hidden" value={planet.id} />
                      <button className="primary-button" type="submit">
                        Claim {planet.production.availableMaterials} Materials
                      </button>
                    </form>
                  ) : null}
                  <Link
                    className="secondary-link"
                    href={`/planets/${encodeURIComponent(planet.id)}`}
                  >
                    Open planet
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          className="command-center-section"
          aria-labelledby="civilization-forces-title"
        >
          <div className="command-center-section-heading command-center-heading-with-link">
            <div>
              <p className="eyebrow">Canonical roster</p>
              <h2 id="civilization-forces-title">
                Civilization ground forces
              </h2>
            </div>
            <Link
              className="secondary-link"
              href={`/units/${encodeURIComponent(civilization.faction.key)}`}
            >
              View Unit Codex
            </Link>
          </div>
          <ul className="command-center-force-list">
            {civilization.forces.map((unit) => (
              <li key={unit.key}>
                <div>
                  <h3>{unit.name}</h3>
                  <p>{unit.category}</p>
                </div>
                <span aria-label={`${unit.name} total quantity`}>
                  {unit.quantity}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="command-center-section"
          aria-labelledby="civilization-activity-title"
        >
          <div className="command-center-section-heading">
            <p className="eyebrow">Latest changes</p>
            <h2 id="civilization-activity-title">Recent activity</h2>
          </div>
          {civilization.activity.length === 0 ? (
            <p className="command-center-activity-empty">
              No civilization activity yet.
            </p>
          ) : (
            <ol className="command-center-activity">
              {civilization.activity.map((entry, index) => (
                <li
                  className={`command-center-activity-${entry.kind}`}
                  key={`${entry.createdAt}-${entry.kind}-${entry.planetId}-${entry.unitKey ?? "materials"}-${index}`}
                >
                  <div className="command-center-activity-heading">
                    <div>
                      <span className="command-center-activity-kind">
                        {entry.kind === "materials" ? "Materials" : "Ground force"}
                      </span>
                      <h3>
                        {entry.kind === "unit" ? `${entry.unitName} · ` : ""}
                        {entry.planetName}
                      </h3>
                    </div>
                    <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                  </div>
                  <p>
                    <strong>{signedDelta(entry.delta)}</strong>
                    {entry.kind === "materials"
                      ? ` · Balance: ${entry.balanceAfter}`
                      : ` · Resulting quantity: ${entry.quantityAfter}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <nav className="command-center-navigation" aria-label="Command center navigation">
          <Link className="secondary-link" href="/planets">
            View all planets
          </Link>
          <Link className="secondary-link" href="/account">
            Back to account
          </Link>
        </nav>
      </div>
    </main>
  )
}
