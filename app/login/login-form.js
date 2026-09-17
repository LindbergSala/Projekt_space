"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../../lib/auth-client.js";

export default function LoginForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setIsPending(true);

    try {
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        setErrorMessage("Email or password is incorrect.");
        return;
      }

      router.replace("/account");
      router.refresh();
    } catch {
      setErrorMessage("Unable to log in right now. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
        />
      </div>

      <div className="form-field">
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
        />
      </div>

      <p className="form-message" role="alert" aria-live="polite">
        {errorMessage}
      </p>

      <button className="primary-button" type="submit" disabled={isPending}>
        {isPending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
