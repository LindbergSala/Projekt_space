import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthenticatedPlayerEntryDestination } from "../lib/authenticated-player-entry.js";

export const dynamic = "force-dynamic";

export default async function Home() {
  const destination = await getAuthenticatedPlayerEntryDestination();

  if (destination !== null) {
    redirect(destination);
  }

  return (
    <main className="home">
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Player entry</p>
        <h1 id="page-title">PROJECT_SPACE</h1>
        <p>A persistent interstellar strategy game.</p>
        <p className="entry-description">
          Establish your faction, command planets, and build a civilization.
        </p>
        <nav className="auth-entry" aria-label="Account access">
          <Link className="primary-link" href="/login">Log in</Link>
          <Link className="secondary-link" href="/register">Create account</Link>
        </nav>
      </section>
    </main>
  );
}
