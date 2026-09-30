import Link from "next/link"

import { requireAuthenticatedFaction } from "../../../lib/authenticated-faction.js"
import { RESET_CIVILIZATION_CONFIRMATION } from "../../../lib/civilization-policy.js"
import { resetCivilizationAction } from "./actions.js"

export const metadata = {
  title: "Reset civilization | Projekt_space",
}

export default async function ResetCivilizationPage({ searchParams }) {
  const faction = await requireAuthenticatedFaction()
  const query = await searchParams
  const hasConfirmationError = query?.error === "confirmation"

  return (
    <main className="auth-page">
      <section className="auth-card reset-card" aria-labelledby="reset-title">
        <div className="auth-heading">
          <p className="eyebrow">Irreversible action</p>
          <h1 id="reset-title">Reset civilization</h1>
          <p>Your current faction is {faction.name}.</p>
        </div>

        <section className="reset-warning" aria-labelledby="deleted-title">
          <h2 id="deleted-title">This permanently deletes</h2>
          <ul>
            <li>All owned planets and their names</li>
            <li>All Materials balances</li>
            <li>All Materials transaction history</li>
            <li>All current gameplay progress</li>
          </ul>
        </section>

        <section className="reset-preserved" aria-labelledby="preserved-title">
          <h2 id="preserved-title">This preserves</h2>
          <ul>
            <li>Your account</li>
            <li>Your email and login</li>
            <li>Your Better Auth sessions and credentials</li>
            <li>Your ability to choose a new faction</li>
          </ul>
        </section>

        <form action={resetCivilizationAction} className="reset-form">
          <div className="form-field">
            <label htmlFor="reset-confirmation">
              Type <strong>{RESET_CIVILIZATION_CONFIRMATION}</strong> exactly
            </label>
            <input
              autoComplete="off"
              id="reset-confirmation"
              name="confirmation"
              required
              type="text"
            />
          </div>
          {hasConfirmationError ? (
            <p className="form-message" role="alert">
              The confirmation was not exact. Nothing was changed.
            </p>
          ) : null}
          <button className="danger-button" type="submit">
            Permanently reset civilization
          </button>
        </form>

        <Link className="secondary-link reset-cancel-link" href="/account">
          Cancel and return to account
        </Link>
      </section>
    </main>
  )
}
