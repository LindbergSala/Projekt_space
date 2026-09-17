"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../../lib/auth-client.js";

const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 128;

export default function RegisterForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const passwordConfirmation = String(
      formData.get("passwordConfirmation") ?? "",
    );

    if (password !== passwordConfirmation) {
      setErrorMessage("Passwords must match.");
      return;
    }

    setIsPending(true);

    try {
      const result = await authClient.signUp.email({ name, email, password });

      if (result.error) {
        setErrorMessage("Unable to create the account. Check your details and try again.");
        return;
      }

      router.replace("/account");
      router.refresh();
    } catch {
      setErrorMessage("Unable to create the account right now. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          disabled={isPending}
        />
      </div>

      <div className="form-field">
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
        />
      </div>

      <div className="form-field">
        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MINIMUM_PASSWORD_LENGTH}
          maxLength={MAXIMUM_PASSWORD_LENGTH}
          aria-describedby="password-requirements"
          required
          disabled={isPending}
        />
        <p className="field-help" id="password-requirements">
          Use between 8 and 128 characters.
        </p>
      </div>

      <div className="form-field">
        <label htmlFor="password-confirmation">Confirm password</label>
        <input
          id="password-confirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          minLength={MINIMUM_PASSWORD_LENGTH}
          maxLength={MAXIMUM_PASSWORD_LENGTH}
          required
          disabled={isPending}
        />
      </div>

      <p className="form-message" role="alert" aria-live="polite">
        {errorMessage}
      </p>

      <button className="primary-button" type="submit" disabled={isPending}>
        {isPending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
