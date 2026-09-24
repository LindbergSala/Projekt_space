import Link from "next/link";

import { getAuthenticatedUserPlanets } from "../../lib/owned-planets.js";
import { establishFirstPlanetAction } from "./actions.js";

export const metadata = {
  title: "Planets | Projekt_space",
};

export default async function PlanetsPage() {
  const planets = await getAuthenticatedUserPlanets();

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="planets-title">
        <div className="auth-heading">
          <p className="eyebrow">Authenticated planets</p>
          <h1 id="planets-title">Your planets</h1>
        </div>

        {planets.length === 0 ? (
          <div className="planet-empty">
            <p>You do not have any planets yet.</p>
            <form
              action={establishFirstPlanetAction}
              className="starter-planet-action"
            >
              <button className="primary-button" type="submit">
                Establish first planet
              </button>
            </form>
          </div>
        ) : (
          <ul className="planet-list">
            {planets.map((planet) => (
              <li className="planet-list-item" key={planet.id}>
                <Link
                  className="planet-list-link"
                  href={`/planets/${encodeURIComponent(planet.id)}`}
                >
                  <span className="planet-list-name">{planet.name}</span>
                  <span className="planet-list-id">{planet.id}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
