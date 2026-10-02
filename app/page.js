import Link from "next/link"
import { redirect } from "next/navigation"

import { getAuthenticatedPlayerEntryDestination } from "../lib/authenticated-player-entry.js"
import { getPlanetaryFactionSummaries } from "../lib/planetary-units.js"

export const metadata = {
  title: "PROJECT_SPACE | Persistent interstellar strategy",
  description:
    "Choose a faction, establish your first planet, and begin a persistent interstellar civilization.",
}

export const dynamic = "force-dynamic"

const CIVILIZATION_STEPS = [
  {
    number: "01",
    title: "Choose your faction",
    description:
      "Select one of four canonical factions for your account-wide civilization.",
  },
  {
    number: "02",
    title: "Establish your first planet",
    description:
      "Create your civilization’s first owned world and give it a name.",
  },
  {
    number: "03",
    title: "Command your civilization",
    description:
      "Read your worlds, Materials, ground forces, and recent activity from one Command Center.",
  },
]

const FOUNDATION_FEATURES = [
  {
    marker: "I",
    title: "Account-wide faction",
    description:
      "Choose one permanent faction for the active civilization, backed by server-side validation and reset boundaries.",
  },
  {
    marker: "II",
    title: "Owned planets",
    description:
      "Establish your first planet, name your worlds, and build or upgrade timed infrastructure that progresses offline.",
  },
  {
    marker: "III",
    title: "Exact Materials records",
    description:
      "Claim earned Materials, spend stored resources on construction and recruitment, and inspect exact balances and transaction history.",
  },
  {
    marker: "IV",
    title: "Planetary forces",
    description:
      "Recruit Line Infantry, let the paid batch train offline, and collect it into your planet’s forces. Other unit and ship production remains planned.",
  },
  {
    marker: "V",
    title: "Unit Codex",
    description:
      "Study the shared planetary roster and each faction’s two canonical unique units without invented combat statistics.",
  },
  {
    marker: "VI",
    title: "Command Center",
    description:
      "Survey worlds, Materials, collected ground forces, construction and recruitment orders, then claim each planet’s earned production.",
  },
]

const STRATEGY_HORIZON = [
  {
    title: "Persistent progression",
    description:
      "Research, additional unit and ship production, and broader shared-world event processing remain planned beyond timed construction and Line Infantry recruitment.",
  },
  {
    title: "Reach beyond one world",
    description:
      "Fleets, troop and cargo transport, and interplanetary travel belong to the planned strategy horizon.",
  },
  {
    title: "Conflict and territory",
    description:
      "Orbital combat, ground combat, plunder, and conquest remain planned systems with rules still to be verified.",
  },
  {
    title: "Shared power",
    description:
      "Alliances and authorized cooperative play are planned after the core world, progression, and conflict systems.",
  },
]

export default async function Home() {
  const destination = await getAuthenticatedPlayerEntryDestination()

  if (destination !== null) {
    redirect(destination)
  }

  const factions = getPlanetaryFactionSummaries()

  return (
    <div className="landing-page">
      <a className="landing-skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="landing-header">
        <div className="landing-shell landing-header-inner">
          <Link className="landing-brand" href="/">
            <span className="landing-brand-mark" aria-hidden="true" />
            PROJECT_SPACE
          </Link>

          <nav className="landing-nav" aria-label="Landing page">
            <a href="#begin">Begin</a>
            <a href="#foundation">Foundation</a>
            <a href="#factions">Factions</a>
            <a href="#horizon">Horizon</a>
          </nav>

          <nav className="landing-account-nav" aria-label="Account access">
            <Link className="landing-login-link" href="/login">
              Log in
            </Link>
            <Link className="landing-button landing-button-primary" href="/register">
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-shell landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow">A persistent interstellar strategy foundation</p>
              <p className="landing-wordmark">PROJECT_SPACE</p>
              <h1 id="landing-title">Build the command structure of a civilization.</h1>
              <p className="landing-hero-description">
                Begin with a faction and a single planet. Establish an
                authoritative record of your worlds, resources, and ground
                forces as PROJECT_SPACE grows toward a wider persistent
                strategy experience.
              </p>
              <div className="landing-hero-actions" aria-label="Get started">
                <Link className="landing-button landing-button-primary" href="/register">
                  Create account
                </Link>
                <Link className="landing-button landing-button-secondary" href="/login">
                  Log in
                </Link>
              </div>
              <p className="landing-hero-note">
                One account. One active civilization. Server-authoritative state.
              </p>
            </div>

            <div className="landing-orbit" aria-hidden="true">
              <div className="landing-orbit-grid" />
              <div className="landing-orbit-ring landing-orbit-ring-outer" />
              <div className="landing-orbit-ring landing-orbit-ring-inner" />
              <div className="landing-orbit-planet">
                <span />
              </div>
              <div className="landing-orbit-moon" />
              <div className="landing-orbit-readout landing-orbit-readout-top">
                SYSTEM / ONLINE
              </div>
              <div className="landing-orbit-readout landing-orbit-readout-bottom">
                CIV / 01
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing-section landing-path"
          id="begin"
          aria-labelledby="begin-title"
        >
          <div className="landing-shell">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">From account to command</p>
              <h2 id="begin-title">Your civilization begins here</h2>
              <p>
                The current player journey is deliberate, compact, and grounded
                in persisted server state.
              </p>
            </div>
            <ol className="landing-step-grid">
              {CIVILIZATION_STEPS.map((step) => (
                <li key={step.number}>
                  <span className="landing-step-number">{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="landing-section landing-foundation"
          id="foundation"
          aria-labelledby="foundation-title"
        >
          <div className="landing-shell">
            <div className="landing-section-heading landing-section-heading-split">
              <div>
                <p className="landing-eyebrow">Available foundation</p>
                <h2 id="foundation-title">Authoritative systems you can inspect today</h2>
              </div>
              <p>
                Grow your planets with timed infrastructure, claim earned
                Materials, and recruit Line Infantry while keeping a clear
                record of your civilization’s resources and forces.
              </p>
            </div>
            <div className="landing-feature-grid">
              {FOUNDATION_FEATURES.map((feature) => (
                <article key={feature.marker}>
                  <span className="landing-feature-marker">{feature.marker}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="landing-section landing-factions"
          id="factions"
          aria-labelledby="factions-title"
        >
          <div className="landing-shell">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Four canonical factions</p>
              <h2 id="factions-title">Choose the identity of your civilization</h2>
              <p>
                Every faction shares seven general planetary units and fields
                two unique units. The cards are informational; faction selection
                happens only after authentication.
              </p>
            </div>
            <div className="landing-faction-grid">
              {factions.map((faction, index) => (
                <article className="landing-faction-card" key={faction.key}>
                  <div className="landing-faction-heading">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{faction.name}</h3>
                  </div>
                  <p>Canonical unique planetary units</p>
                  <ul>
                    {faction.uniqueUnitNames.map((unitName) => (
                      <li key={unitName}>{unitName}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="landing-section landing-horizon"
          id="horizon"
          aria-labelledby="horizon-title"
        >
          <div className="landing-shell landing-horizon-shell">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Strategy horizon · Planned</p>
              <h2 id="horizon-title">A larger persistent game is under development</h2>
              <p>
                These systems describe the documented direction of
                PROJECT_SPACE. They are planned work, not claims about the
                currently playable foundation.
              </p>
            </div>
            <div className="landing-horizon-grid">
              {STRATEGY_HORIZON.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-cta" aria-labelledby="landing-cta-title">
          <div className="landing-shell landing-cta-inner">
            <div>
              <p className="landing-eyebrow">Open your command channel</p>
              <h2 id="landing-cta-title">Begin your civilization.</h2>
              <p>
                Create an account, choose your faction, and establish your first
                world.
              </p>
            </div>
            <div className="landing-cta-actions">
              <Link className="landing-button landing-button-primary" href="/register">
                Create account
              </Link>
              <Link className="landing-button landing-button-secondary" href="/login">
                Log in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-shell landing-footer-inner">
          <div>
            <strong>PROJECT_SPACE</strong>
            <p>A persistent interstellar strategy game in active development.</p>
          </div>
          <span>projekt-space.vercel.app</span>
        </div>
      </footer>
    </div>
  )
}
