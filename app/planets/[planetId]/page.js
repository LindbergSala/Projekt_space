import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAuthenticatedPlanetaryForces,
  getAuthenticatedUserPlanetById,
} from "../../../lib/owned-planets.js";
import { renamePlanetAction } from "../actions.js";

function signedDelta(delta) {
  return delta.startsWith("-") ? delta : `+${delta}`;
}

export default async function PlanetPage({ params }) {
  const { planetId } = await params;
  const [planet, forces] = await Promise.all([
    getAuthenticatedUserPlanetById(planetId),
    getAuthenticatedPlanetaryForces(planetId),
  ]);

  if (planet === null || forces === null) {
    notFound();
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="planet-title">
        <div className="auth-heading">
          <h1 id="planet-title">{planet.name}</h1>
        </div>

        <div className="planet-details">
          <p className="planet-id">{planet.id}</p>
        </div>

        <section className="planet-resources" aria-labelledby="resources-title">
          <h2 id="resources-title">Resources</h2>
          <dl>
            <div>
              <dt>Materials</dt>
              <dd>{planet.materials}</dd>
            </div>
          </dl>
        </section>

        <section
          className="unit-history"
          aria-labelledby="unit-history-title"
        >
          <h2 id="unit-history-title">Planetary force history</h2>
          {planet.unitHistory.length === 0 ? (
            <p className="unit-history-empty">
              No planetary force changes yet.
            </p>
          ) : (
            <ol>
              {planet.unitHistory.map((entry, index) => (
                <li key={`${entry.createdAt}-${entry.unitKey}-${index}`}>
                  <div className="unit-history-heading">
                    <strong>{entry.unitName}</strong>
                    <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                  </div>
                  <p>
                    <span>{signedDelta(entry.delta)}</span>
                    {" · "}
                    Resulting quantity: {entry.quantityAfter}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          className="planetary-forces"
          aria-labelledby="planetary-forces-title"
        >
          <div className="planetary-forces-heading">
            <h2 id="planetary-forces-title">Planetary forces</h2>
            <Link href={`/units/${encodeURIComponent(forces.faction.key)}`}>
              {forces.faction.name} Unit Codex
            </Link>
          </div>
          <ul>
            {forces.units.map((unit) => (
              <li key={unit.key}>
                <div>
                  <h3>{unit.name}</h3>
                  <p>{unit.category}</p>
                </div>
                <span aria-label={`${unit.name} quantity`}>
                  {unit.quantity}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="material-history"
          aria-labelledby="material-history-title"
        >
          <h2 id="material-history-title">Materials history</h2>
          {planet.materialHistory.length === 0 ? (
            <p className="material-history-empty">No material changes yet.</p>
          ) : (
            <ol>
              {planet.materialHistory.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`}>
                  <div className="material-history-heading">
                    <strong>{signedDelta(entry.delta)}</strong>
                    <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                  </div>
                  <p>Balance: {entry.balanceAfter}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <form action={renamePlanetAction} className="planet-rename-form">
          <input name="planetId" type="hidden" value={planet.id} />
          <label htmlFor="planet-name">Planet name</label>
          <input
            defaultValue={planet.name}
            id="planet-name"
            name="planetName"
            required
            type="text"
          />
          <button className="primary-button" type="submit">
            Rename planet
          </button>
        </form>

        <nav className="planet-navigation" aria-label="Planet navigation">
          <Link className="secondary-link" href="/civilization">
            Command Center
          </Link>
          <Link className="secondary-link planet-back-link" href="/planets">
            Back to planets
          </Link>
        </nav>
      </section>
    </main>
  );
}
