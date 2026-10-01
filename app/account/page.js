import Link from "next/link";

import LogoutButton from "./logout-button.js";
import { getAuthenticatedFaction } from "../../lib/authenticated-faction.js";
import { requireAuthenticatedUser } from "../../lib/auth-session.js";

export const metadata = {
  title: "Account | Projekt_space",
};

export default async function AccountPage() {
  const user = await requireAuthenticatedUser();
  const faction = await getAuthenticatedFaction();

  return (
    <main className="auth-page">
      <section className="auth-card account-card" aria-labelledby="account-title">
        <div className="auth-heading">
          <p className="eyebrow">Authenticated account</p>
          <h1 id="account-title">Your account</h1>
        </div>

        <dl className="account-details">
          <div>
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>

        <section className="account-civilization" aria-labelledby="civilization-title">
          <h2 id="civilization-title">Civilization</h2>
          {faction === null ? (
            <>
              <p>Faction not selected</p>
              <Link className="primary-link" href="/faction">
                Choose faction
              </Link>
            </>
          ) : (
            <>
              <p>{faction.name}</p>
              <nav className="civilization-navigation" aria-label="Civilization navigation">
                <Link className="primary-link" href="/civilization">
                  Command Center
                </Link>
                <Link className="secondary-link" href={`/units/${faction.key}`}>
                  View faction roster
                </Link>
                <Link className="secondary-link" href="/planets">
                  View planets
                </Link>
                <Link className="danger-link" href="/civilization/reset">
                  Reset civilization
                </Link>
              </nav>
            </>
          )}
        </section>

        <LogoutButton />
      </section>
    </main>
  );
}
