import Link from "next/link";
import { notFound } from "next/navigation";

import { getAuthenticatedUserPlanetById } from "../../../lib/owned-planets.js";

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
          <h1 id="planet-title">Planet</h1>
        </div>

        <p className="planet-id">{planet.id}</p>

        <Link className="secondary-link planet-back-link" href="/planets">
          Back to planets
        </Link>
      </section>
    </main>
  );
}
