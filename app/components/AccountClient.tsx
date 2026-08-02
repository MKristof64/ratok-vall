"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AccountLoginForm, RegisterForm } from "./AuthForms";
import { Brand, ErrorView, LoadingView, StatusPill } from "./AppChrome";
import { CopyInviteButton } from "./ShareControls";
import {
  isAuthState,
  type AccountRoom,
  type AccountRoomsResponse,
  type AuthState,
} from "./account-types";
import { getApiError } from "./game-types";

const statusLabels = {
  collecting: "Gyűjtés",
  playing: "Játékban",
  finished: "Befejezve",
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nemrég frissítve";
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AccountClient() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<AccountRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [confirmingCode, setConfirmingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);

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
        window.location.replace("/unlock?returnTo=%2Faccount");
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

  const loadRooms = useCallback(async (quiet = false) => {
    if (!quiet) setRoomsLoading(true);
    try {
      const response = await fetch("/api/account/rooms", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.replace("/unlock?returnTo=%2Faccount");
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as AccountRoomsResponse;
      setRooms(Array.isArray(payload.rooms) ? payload.rooms : []);
      setRoomsError(null);
    } catch (requestError) {
      setRoomsError(
        requestError instanceof Error
          ? requestError.message
          : "A játékok most nem tölthetők be.",
      );
    } finally {
      if (!quiet) setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (auth?.kind !== "account") return;
    void loadRooms();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadRooms(true);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [auth?.kind, loadRooms]);

  const refreshAfterAuth = async () => {
    await loadAuth();
  };

  const logout = async () => {
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(await getApiError(response, "A kijelentkezés nem sikerült."));
      window.location.replace("/unlock");
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error ? requestError.message : "A kijelentkezés nem sikerült.",
      );
    }
  };

  const deleteRoom = async (code: string) => {
    setDeletingCode(code);
    setRoomsError(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.replace("/unlock?returnTo=%2Faccount");
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response, "A játék nem törölhető."));
      setRooms((current) => current.filter((room) => room.code !== code));
      setConfirmingCode(null);
    } catch (requestError) {
      setRoomsError(
        requestError instanceof Error ? requestError.message : "A játék nem törölhető.",
      );
    } finally {
      setDeletingCode(null);
    }
  };

  const accountInitial = useMemo(
    () => auth?.kind === "account" ? auth.account.email.slice(0, 1).toLocaleUpperCase("hu") : "?",
    [auth],
  );

  return (
    <main className="game-shell account-shell">
      <header className="game-topbar">
        <Brand />
        <span className="account-current-chip">Fiókom</span>
      </header>

      {authLoading ? <LoadingView label="A fiókod betöltése…" /> : null}

      {!authLoading && authError && !auth ? (
        <ErrorView message={authError} onRetry={() => void loadAuth()} />
      ) : null}

      {!authLoading && auth?.kind === "guest" ? (
        <div className="account-content">
          <section className="account-hero" aria-labelledby="account-title">
            <p className="eyebrow">Vendég munkamenet</p>
            <h1 id="account-title">Legyen saját helyük a játékaidnak.</h1>
            <p>
              Fiókkal új játékot indíthatsz, és később is visszatérhetsz a házigazda nézethez.
              A játékosok mondatai ettől továbbra is névtelenek maradnak.
            </p>
          </section>
          <div className="guest-account-note">
            <span aria-hidden="true">✓</span>
            <p>A közös jelszóval már beléptél, ezért most biztonságosan létrehozhatsz egy fiókot.</p>
          </div>
          <div className="account-auth-grid">
            <RegisterForm onSuccess={refreshAfterAuth} />
            <AccountLoginForm
              description="Ha korábban már regisztráltál, itt folytathatod."
              onSuccess={refreshAfterAuth}
              returnTo="/account"
            />
          </div>
        </div>
      ) : null}

      {!authLoading && auth?.kind === "account" ? (
        <div className="account-content">
          <section className="account-profile" aria-labelledby="account-title">
            <div className="account-avatar" aria-hidden="true">{accountInitial}</div>
            <div className="account-profile-copy">
              <p className="eyebrow">Saját fiók</p>
              <h1 id="account-title">A játékaid egy helyen.</h1>
              <p className="account-email">{auth.account.email}</p>
            </div>
            <button className="button button-secondary account-logout" onClick={() => void logout()} type="button">
              Kijelentkezés
            </button>
          </section>

          {authError ? <div className="form-error" role="alert"><span aria-hidden="true">!</span><p>{authError}</p></div> : null}

          <section className="account-rooms" aria-labelledby="rooms-title">
            <div className="account-section-heading">
              <div>
                <p className="eyebrow">Házigazda nézetek</p>
                <h2 id="rooms-title">Saját játékok</h2>
              </div>
              <a className="button button-primary" href="/">Új játék</a>
            </div>

            {roomsError ? (
              <div className="form-error" role="alert">
                <span aria-hidden="true">!</span>
                <p>{roomsError}</p>
                <button className="text-button" onClick={() => void loadRooms()} type="button">Újrapróbálom</button>
              </div>
            ) : null}

            {roomsLoading ? <LoadingView label="A játékaid betöltése…" /> : null}

            {!roomsLoading && rooms.length === 0 ? (
              <div className="account-empty-state">
                <span className="account-empty-symbol" aria-hidden="true">“</span>
                <h3>Még nincs saját játékod.</h3>
                <p>Indíts egy kört, majd oszd meg a meghívót a társasággal.</p>
                <a className="button button-primary" href="/">Első játék indítása</a>
              </div>
            ) : null}

            {!roomsLoading && rooms.length > 0 ? (
              <ul className="account-room-list">
                {rooms.map((room) => {
                  const invitePath = room.inviteUrlPath || `/room/${encodeURIComponent(room.code)}`;
                  const hostPath = room.hostUrlPath || `/host/${encodeURIComponent(room.code)}`;
                  const inviteUrl = origin ? new URL(invitePath, origin).toString() : invitePath;
                  return (
                    <li className="account-room-card" key={room.code}>
                      <div className="account-room-main">
                        <div className="account-room-heading">
                          <div>
                            <h3>{room.title || "Névtelen kör"}</h3>
                            <p>Frissítve: {formatUpdatedAt(room.updatedAt)}</p>
                          </div>
                          <StatusPill tone={room.status === "playing" ? "live" : room.status === "finished" ? "done" : "neutral"}>
                            {statusLabels[room.status]}
                          </StatusPill>
                        </div>
                        <dl className="account-room-stats">
                          <div><dt>Célpont</dt><dd>{room.participantCount}</dd></div>
                          <div><dt>Mondat</dt><dd>{room.submissionCount}</dd></div>
                          <div><dt>Felfedés</dt><dd>{room.revealTargetNames ? "Névvel" : "Név nélkül"}</dd></div>
                        </dl>
                      </div>
                      <div className="account-room-actions">
                        <a className="button button-primary" href={hostPath}>Kezelés</a>
                        <CopyInviteButton url={inviteUrl} />
                        {confirmingCode === room.code ? (
                          <div className="account-delete-confirm" role="alert">
                            <strong>Biztosan törlöd?</strong>
                            <span>A mondatok végleg elvesznek.</span>
                            <div>
                              <button
                                autoFocus
                                className="button button-danger"
                                disabled={deletingCode === room.code}
                                onClick={() => void deleteRoom(room.code)}
                                type="button"
                              >
                                {deletingCode === room.code ? "Törlés…" : "Igen, törlöm"}
                              </button>
                              <button className="button button-quiet" onClick={() => setConfirmingCode(null)} type="button">Mégsem</button>
                            </div>
                          </div>
                        ) : (
                          <button className="button button-quiet danger-trigger" onClick={() => setConfirmingCode(room.code)} type="button">
                            Törlés
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <p className="account-anonymity-note">
            A fiók csak azt rögzíti, mely játékokat kezeled házigazdaként. A beküldött mondatokat nem kapcsoljuk a játékosok fiókjához vagy e-mail-címéhez.
          </p>
        </div>
      ) : null}
    </main>
  );
}
