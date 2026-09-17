import Link from "next/link";

import LoginForm from "./login-form.js";

export const metadata = {
  title: "Log in | Projekt_space",
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-heading">
          <p className="eyebrow">Player access</p>
          <h1 id="login-title">Log in</h1>
          <p>Continue with your registered email and password.</p>
        </div>
        <LoginForm />
        <p className="auth-alternative">
          Need an account? <Link href="/register">Create one</Link>
        </p>
      </section>
    </main>
  );
}
