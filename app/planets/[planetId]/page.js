import Link from "next/link";
import { notFound } from "next/navigation";

import { getAuthenticatedUserPlanetById } from "../../../lib/owned-planets.js";
import { renamePlanetAction } from "../actions.js";

function signedDelta(delta) {
  return delta.startsWith("-") ? delta : `+${delta}`;
}

export default async function PlanetPage({ params }) {
  const { planetId } = await params;
  const planet = await getAuthenticatedUserPlanetById(planetId);

  if (planet === null) {
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

        <Link className="secondary-link planet-back-link" href="/planets">
          Back to planets
        </Link>
      </section>
    </main>
  );
}
