"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { isAuthState, type AuthState } from "./account-types";
import type { CreateRoomResponse } from "./game-types";
import { getApiError } from "./game-types";

const MAX_PARTICIPANTS = 30;

export function CreateGameForm() {
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState(["", "", ""]);
  const [revealTargetNames, setRevealTargetNames] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.replace("/unlock?returnTo=%2F");
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as unknown;
      if (!isAuthState(payload)) throw new Error("A fiókállapot nem olvasható.");
      setAuth(payload);
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error
          ? requestError.message
          : "A fiókállapot most nem tölthető be.",
      );
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  const updateParticipant = (index: number, value: string) => {
    setParticipants((current) =>
      current.map((participant, participantIndex) =>
        participantIndex === index ? value : participant,
      ),
    );
    setError(null);
  };

  const addParticipant = () => {
    if (participants.length >= MAX_PARTICIPANTS) return;
    setParticipants((current) => [...current, ""]);
  };

  const removeParticipant = (index: number) => {
    setParticipants((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const cleanParticipants = participants.map((name) => name.trim()).filter(Boolean);
    if (cleanParticipants.length < 2) {
      setError("Adj meg legalább két célpontot.");
      return;
    }

    const normalized = cleanParticipants.map((name) => name.toLocaleLowerCase("hu"));
    if (new Set(normalized).size !== normalized.length) {
      setError("Minden célpont neve legyen különböző.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          participants: cleanParticipants,
          revealTargetNames,
        }),
      });

      if (response.status === 401) {
        window.location.assign("/unlock?returnTo=%2F");
        return;
      }

      if (response.status === 403) {
        setAuth({ authenticated: true, kind: "guest", account: null });
        throw new Error("Új játék indításához jelentkezz be egy saját fiókkal.");
      }

      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as CreateRoomResponse;
      const code = payload.code || payload.room.code;
      if (!code) throw new Error("A játék nem jött létre megfelelően.");

      window.location.assign(
        `/host/${encodeURIComponent(code)}${payload.hostToken ? `#host=${encodeURIComponent(payload.hostToken)}` : ""}`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "A játék most nem hozható létre. Próbáld újra.",
      );
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <section className="create-card auth-guard-card" aria-busy="true">
        <span className="loader" aria-hidden="true" />
        <p>A fiókod ellenőrzése…</p>
      </section>
    );
  }

  if (authError || !auth) {
    return (
      <section className="create-card auth-guard-card" role="alert">
        <div className="auth-guard-symbol" aria-hidden="true">!</div>
        <p className="eyebrow">Kapcsolódási hiba</p>
        <h2>A fiókállapot most nem tölthető be.</h2>
        <p>{authError || "Próbáld újra egy pillanat múlva."}</p>
        <button className="button button-secondary" onClick={() => void loadAuth()} type="button">Újrapróbálom</button>
      </section>
    );
  }

  if (auth.kind === "guest") {
    return (
      <section className="create-card auth-guard-card" aria-labelledby="account-needed-title">
        <div className="auth-guard-symbol auth-guard-account" aria-hidden="true">●</div>
        <p className="eyebrow">Fiók szükséges</p>
        <h2 id="account-needed-title">Játékot saját fiókkal indíthatsz.</h2>
        <p>
          A fiók csak a saját játékaid kezelésére szolgál. A meghívottak továbbra is
          fiók nélkül, névtelenül küldhetnek be mondatokat.
        </p>
        <a className="button button-primary button-full" href="/account">
          Fiók létrehozása vagy belépés <span aria-hidden="true">→</span>
        </a>
        <p className="form-footnote">Már beléptél a közös jelszóval, ezért regisztrálhatsz.</p>
      </section>
    );
  }

  return (
    <form className="create-card" onSubmit={submit} noValidate>
      <div className="form-heading">
        <div>
          <p className="eyebrow">Új játék</p>
          <h2>Állítsd össze a társaságot</h2>
        </div>
        <span className="form-time">kb. 1 perc</span>
      </div>

      <div className="form-account-status">
        <span className="account-link-mark" aria-hidden="true" />
        <span>Belépve: <strong>{auth.account.email}</strong></span>
      </div>

      {error ? (
        <div className="form-error" role="alert">
          <span aria-hidden="true">!</span>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="field-group">
        <label htmlFor="game-title">Játék neve <span>(nem kötelező)</span></label>
        <input
          id="game-title"
          maxLength={60}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Például: Péntek esti kör"
          type="text"
          value={title}
        />
      </div>

      <fieldset className="participant-fieldset">
        <legend>Célpontok</legend>
        <p className="field-help">
          Add meg azok nevét vagy becenevét, akikre a mondatok vonatkozhatnak.
        </p>
        <div className="participant-list">
          {participants.map((participant, index) => (
            <div className="participant-row" key={index}>
              <span className="participant-index" aria-hidden="true">{index + 1}</span>
              <label className="sr-only" htmlFor={`participant-${index}`}>
                {index + 1}. célpont neve
              </label>
              <input
                autoComplete="off"
                id={`participant-${index}`}
                maxLength={40}
                onChange={(event) => updateParticipant(index, event.target.value)}
                placeholder="Név vagy becenév"
                type="text"
                value={participant}
              />
              <button
                aria-label={`${index + 1}. célpont eltávolítása`}
                className="icon-button"
                disabled={participants.length <= 2}
                onClick={() => removeParticipant(index)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
        </div>
        <button
          className="text-button"
          disabled={participants.length >= MAX_PARTICIPANTS}
          onClick={addParticipant}
          type="button"
        >
          <span aria-hidden="true">＋</span> Új célpont hozzáadása
        </button>
      </fieldset>

      <label className="switch-card" htmlFor="target-reveal">
        <span>
          <strong>Célpont megnevezése</strong>
          <small>
            Bekapcsolva a mondat után felfedhető, kire gondolt a beküldő.
          </small>
        </span>
        <span className="switch-control">
          <input
            checked={revealTargetNames}
            id="target-reveal"
            onChange={(event) => setRevealTargetNames(event.target.checked)}
            role="switch"
            type="checkbox"
          />
          <span aria-hidden="true" />
        </span>
      </label>

      <button className="button button-primary button-full" disabled={submitting} type="submit">
        {submitting ? "Létrehozás…" : "Játék létrehozása"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </button>
      <p className="form-footnote">A beküldőknek nem kell fiókot létrehozniuk, a mondataik névtelenek maradnak.</p>
    </form>
  );
}
