import Link from "next/link";

import LogoutButton from "./logout-button.js";
import { requireAuthenticatedUser } from "../../lib/auth-session.js";

export const metadata = {
  title: "Account | Projekt_space",
};

export default async function AccountPage() {
  const user = await requireAuthenticatedUser();

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

        <Link className="secondary-link account-navigation" href="/planets">
          View planets
        </Link>

        <LogoutButton />
      </section>
    </main>
  );
}
