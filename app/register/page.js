import Link from "next/link";

import RegisterForm from "./register-form.js";

export const metadata = {
  title: "Create account | Projekt_space",
};

export default function RegisterPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <div className="auth-heading">
          <p className="eyebrow">Player access</p>
          <h1 id="register-title">Create account</h1>
          <p>Register with email and password to access your account.</p>
        </div>
        <RegisterForm />
        <p className="auth-alternative">
          Already registered? <Link href="/login">Log in</Link>
        </p>
      </section>
    </main>
  );
}
