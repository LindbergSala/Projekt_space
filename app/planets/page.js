import { getAuthenticatedUserPlanetIds } from "../../lib/owned-planets.js";

export const metadata = {
  title: "Planets | Projekt_space",
};

export default async function PlanetsPage() {
  const planetIds = await getAuthenticatedUserPlanetIds();

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="planets-title">
        <div className="auth-heading">
          <p className="eyebrow">Authenticated planets</p>
          <h1 id="planets-title">Your planets</h1>
        </div>

        {planetIds.length === 0 ? (
          <p className="planet-empty">You do not have any planets yet.</p>
        ) : (
          <ul className="planet-list">
            {planetIds.map((planetId) => (
              <li className="planet-list-item" key={planetId}>
                {planetId}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
