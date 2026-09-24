import Link from "next/link";
import { notFound } from "next/navigation";

import { getAuthenticatedUserPlanetById } from "../../../lib/owned-planets.js";
import { renamePlanetAction } from "../actions.js";

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
