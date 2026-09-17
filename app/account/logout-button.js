"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../../lib/auth-client.js";

export default function LogoutButton() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setErrorMessage("");
    setIsPending(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setErrorMessage("Unable to log out. Please try again.");
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setErrorMessage("Unable to log out right now. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="logout-action">
      <p className="form-message" role="alert" aria-live="polite">
        {errorMessage}
      </p>
      <button
        className="secondary-button"
        type="button"
        onClick={handleLogout}
        disabled={isPending}
      >
        {isPending ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}
