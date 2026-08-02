"use client";

import { useState, type FormEvent } from "react";
import { getApiError } from "./game-types";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function PasswordField({
  id,
  label = "Jelszó",
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field-group password-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-action">
        <input
          aria-describedby={describedBy}
          autoComplete={autoComplete}
          id={id}
          maxLength={256}
          onChange={(event) => onChange(event.target.value)}
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={visible ? "Jelszó elrejtése" : "Jelszó megjelenítése"}
          className="input-action"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? "Elrejt" : "Mutat"}
        </button>
      </div>
    </div>
  );
}

export function AccountLoginForm({
  returnTo,
  onSuccess,
  heading = "Belépés fiókkal",
  description = "Folytasd a saját játékaid kezelését.",
  eyebrow = "Meglévő fiók",
}: {
  returnTo: string;
  onSuccess?: () => void | Promise<void>;
  heading?: string;
  description?: string;
  eyebrow?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLocaleLowerCase("hu");
    if (!validEmail(cleanEmail)) {
      setError("Adj meg egy érvényes e-mail-címet.");
      return;
    }
    if (!password) {
      setError("Add meg a jelszavad.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: cleanEmail, password, returnTo }),
      });
      if (!response.ok) {
        const fallback =
          response.status === 429
            ? "Túl sok próbálkozás. Várj egy percet."
            : "Az e-mail-cím vagy a jelszó nem megfelelő.";
        throw new Error(await getApiError(response, fallback));
      }

      if (onSuccess) {
        await onSuccess();
        setSubmitting(false);
      } else {
        window.location.replace(returnTo);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Most nem sikerült belépni. Próbáld újra.",
      );
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-card" onSubmit={submit} noValidate>
      <div className="auth-card-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{heading}</h2>
        <p>{description}</p>
      </div>
      {error ? <div className="form-error" role="alert"><span aria-hidden="true">!</span><p>{error}</p></div> : null}
      <div className="field-group">
        <label htmlFor="account-login-email">E-mail-cím</label>
        <input
          autoComplete="email"
          id="account-login-email"
          inputMode="email"
          maxLength={254}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          placeholder="nev@pelda.hu"
          type="email"
          value={email}
        />
      </div>
      <PasswordField
        autoComplete="current-password"
        id="account-login-password"
        onChange={(value) => {
          setPassword(value);
          setError(null);
        }}
        value={password}
      />
      <button className="button button-primary button-full" disabled={submitting} type="submit">
        {submitting ? "Belépés…" : "Belépés a fiókba"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </button>
    </form>
  );
}

export function RegisterForm({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLocaleLowerCase("hu");
    if (!validEmail(cleanEmail)) {
      setError("Adj meg egy érvényes e-mail-címet.");
      return;
    }
    if (!password) {
      setError("Válassz egy jelszót.");
      return;
    }
    if (Array.from(password).length < 12) {
      setError("A jelszó legyen legalább 12 karakter hosszú.");
      return;
    }
    if (password !== confirmation) {
      setError("A két jelszó nem egyezik.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      if (!response.ok) {
        const fallback =
          response.status === 409
            ? "Ehhez az e-mail-címhez már tartozik fiók."
            : response.status === 401
              ? "Regisztráció előtt lépj be a közös jelszóval."
              : "A fiók most nem hozható létre. Próbáld újra.";
        throw new Error(await getApiError(response, fallback));
      }
      await onSuccess();
      setSubmitting(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "A fiók most nem hozható létre. Próbáld újra.",
      );
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-card register-card" onSubmit={submit} noValidate>
      <div className="auth-card-heading">
        <p className="eyebrow">Új fiók</p>
        <h2>Fiók létrehozása</h2>
        <p>A fiók a saját játékaid kezelésére szolgál. A beküldött mondatok szerzői továbbra is névtelenek.</p>
      </div>
      {error ? <div className="form-error" role="alert"><span aria-hidden="true">!</span><p>{error}</p></div> : null}
      <div className="field-group">
        <label htmlFor="register-email">E-mail-cím</label>
        <input
          autoComplete="email"
          id="register-email"
          inputMode="email"
          maxLength={254}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          placeholder="nev@pelda.hu"
          type="email"
          value={email}
        />
      </div>
      <PasswordField
        autoComplete="new-password"
        describedBy="new-password-help"
        id="register-password"
        onChange={(value) => {
          setPassword(value);
          setError(null);
        }}
        value={password}
      />
      <p className="field-help auth-password-help" id="new-password-help">Legalább 12 karaktert és lehetőleg egyedi jelszót használj.</p>
      <PasswordField
        autoComplete="new-password"
        id="register-password-confirmation"
        label="Jelszó még egyszer"
        onChange={(value) => {
          setConfirmation(value);
          setError(null);
        }}
        value={confirmation}
      />
      <button className="button button-primary button-full" disabled={submitting} type="submit">
        {submitting ? "Fiók létrehozása…" : "Fiók létrehozása"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </button>
    </form>
  );
}
