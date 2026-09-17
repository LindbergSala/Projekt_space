import Link from "next/link";

export default function Home() {
  return (
    <main className="home">
      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">Projekt_space</h1>
        <p>Develop planets. Command fleets. Forge alliances.</p>
        <nav className="auth-entry" aria-label="Account access">
          <Link className="primary-link" href="/login">Log in</Link>
          <Link className="secondary-link" href="/register">Create account</Link>
        </nav>
      </section>
    </main>
  );
}
