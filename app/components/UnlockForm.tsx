"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getApiError } from "./game-types";

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  try {
    const parsed = new URL(value, "https://ratok-vall.invalid");
    if (parsed.origin !== "https://ratok-vall.invalid") return "/";
    if (parsed.pathname === "/unlock" || parsed.pathname.startsWith("/api/auth/")) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function UnlockForm() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [returnTo, setReturnTo] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPath = safeReturnPath(params.get("returnTo"));
    const hostRoute = requestedPath.match(/^\/host\/([^/?#]+)(?:[/?#]|$)/);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hostToken = fragment.get("host");

    if (hostRoute && hostToken && /^[A-Za-z0-9_-]{20,256}$/.test(hostToken)) {
      try {
        const roomCode = decodeURIComponent(hostRoute[1]);
        window.sessionStorage.setItem(`ratok-vall-host-${roomCode}`, hostToken);
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      } catch {
        // A hibás útvonalat nem őrizzük meg; a biztonságos returnTo továbbra is működik.
      }
    }

    setReturnTo(requestedPath);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError("Add meg a közös jelszót.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ password, returnTo }),
      });

      if (!response.ok) {
        const fallback =
          response.status === 429
            ? "Túl sok próbálkozás. Várj egy percet."
            : "A jelszó nem megfelelő. Próbáld újra.";
        throw new Error(await getApiError(response, fallback));
      }

      window.location.replace(returnTo);
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
    <form className="unlock-card" onSubmit={submit} noValidate>
      <div className="unlock-symbol" aria-hidden="true">•••</div>
      <p className="eyebrow">Meghívásos játék</p>
      <h1>Belépés a játékhoz</h1>
      <p className="unlock-lead">Add meg a közös jelszót a folytatáshoz.</p>

      {error ? <div className="form-error" role="alert"><span aria-hidden="true">!</span><p>{error}</p></div> : null}

      <div className="field-group password-field">
        <label htmlFor="shared-password">Jelszó</label>
        <div className="input-with-action">
          <input
            autoComplete="current-password"
            id="shared-password"
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={showPassword ? "Jelszó elrejtése" : "Jelszó megjelenítése"}
            className="input-action"
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? "Elrejt" : "Mutat"}
          </button>
        </div>
      </div>

      <button className="button button-primary button-full" disabled={submitting} type="submit">
        {submitting ? "Belépés…" : "Belépés"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </button>
      <p className="unlock-footnote">A jelszót biztonságos kapcsolat továbbítja.</p>
    </form>
  );
}
