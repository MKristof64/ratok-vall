"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorView, GameHeader, LoadingView, StatusPill } from "./AppChrome";
import { ShareControls } from "./ShareControls";
import {
  getApiError,
  getTargetName,
  getTotalSubmissions,
  isTargetRevealed,
  type GameRoom,
  type RoomResponse,
} from "./game-types";
import { useRoomPolling } from "./useRoomPolling";

type ActionName =
  | "settings"
  | "start"
  | "reveal"
  | "next"
  | "finish"
  | "restart"
  | "delete";

type HostAccessResponse = {
  hasHostAccess: boolean;
  via: "account" | "token" | null;
};

function HostRoomHeading({ room }: { room: GameRoom }) {
  const labels = {
    collecting: "Gyűjtés folyamatban",
    playing: "Játékban",
    finished: "Befejezve",
  };
  return (
    <div className="room-title-row host-title-row">
      <div>
        <p className="room-kicker">Házigazda nézet</p>
        <h1>{room.title || "Névtelen kör"}</h1>
      </div>
      <StatusPill tone={room.status === "playing" ? "live" : room.status === "finished" ? "done" : "neutral"}>
        {labels[room.status]}
      </StatusPill>
    </div>
  );
}

function HostPanel({
  title,
  eyebrow,
  children,
  className = "",
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`host-panel ${className}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export function HostRoom({ code }: { code: string }) {
  const { room, setRoom, loading, error, notFound, refresh } = useRoomPolling(code, 2200);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [accountHostAccess, setAccountHostAccess] = useState<boolean | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardTitleRef = useRef<HTMLHeadingElement>(null);
  const finishedTitleRef = useRef<HTMLHeadingElement>(null);
  const finishDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    const storageKey = `ratok-vall-host-${code}`;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const tokenFromUrl = fragment.get("host");
    if (tokenFromUrl) {
      window.sessionStorage.setItem(storageKey, tokenFromUrl);
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      setHostToken(tokenFromUrl);
      setAccountHostAccess(false);
    } else {
      const storedToken = window.sessionStorage.getItem(storageKey);
      if (storedToken) {
        setHostToken(storedToken);
        setAccountHostAccess(false);
      } else {
        setHostToken("");
        setAccountHostAccess(null);
        void (async () => {
          try {
            const response = await fetch(
              `/api/rooms/${encodeURIComponent(code)}/host-access`,
              {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/json" },
              },
            );
            if (response.status === 401) {
              const returnTo = `${window.location.pathname}${window.location.search}`;
              window.location.replace(`/unlock?returnTo=${encodeURIComponent(returnTo)}`);
              return;
            }
            if (!response.ok) {
              if (active) setAccountHostAccess(false);
              return;
            }
            const payload = (await response.json()) as HostAccessResponse;
            if (active) setAccountHostAccess(payload.hasHostAccess === true);
          } catch {
            if (active) {
              setAccountHostAccess(false);
              setActionError("A házigazda-hozzáférés most nem ellenőrizhető.");
            }
          }
        })();
      }
    }
    setInviteUrl(`${window.location.origin}/room/${encodeURIComponent(code)}`);
    return () => {
      active = false;
    };
  }, [code]);

  const cardKey = `${room?.currentIndex ?? -1}:${room?.currentCard?.id ?? "none"}`;
  const shouldFocusCard = room?.status === "playing" && Boolean(room.currentCard);
  useEffect(() => {
    if (shouldFocusCard) cardTitleRef.current?.focus();
  }, [cardKey, shouldFocusCard]);

  useEffect(() => {
    if (room?.status === "finished") finishedTitleRef.current?.focus();
  }, [room?.status]);

  const hostFetch = async (
    path: string,
    method: "POST" | "PATCH" | "DELETE" = "POST",
    body?: Record<string, unknown>,
  ) => {
    if (!hostToken && accountHostAccess !== true) {
      throw new Error("A házigazda-hozzáférés hiányzik.");
    }
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
        ...(hostToken ? { "x-host-token": hostToken } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 401) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/unlock?returnTo=${encodeURIComponent(returnTo)}`);
      throw new Error("Új belépés szükséges.");
    }
    if (response.status === 403) {
      throw new Error("Nincs jogosultságod ennek a játéknak a kezeléséhez.");
    }
    if (!response.ok) throw new Error(await getApiError(response));
    if (response.status === 204) return null;

    const payload = (await response.json()) as Partial<RoomResponse>;
    return payload.room ?? null;
  };

  const perform = async (name: ActionName, action: () => Promise<void>) => {
    setBusy(name);
    setActionError(null);
    try {
      await action();
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "A művelet most nem sikerült. Próbáld újra.",
      );
    } finally {
      setBusy(null);
    }
  };

  const runAndUpdate = (name: Exclude<ActionName, "delete">, path: string) =>
    perform(name, async () => {
      const updatedRoom = await hostFetch(path);
      if (updatedRoom) setRoom(updatedRoom);
      else await refresh();
    });

  const updateRevealSetting = (nextValue: boolean) => {
    if (!room) return;
    const previousRoom = room;
    setRoom({ ...room, revealTargetNames: nextValue });
    void perform("settings", async () => {
      try {
        const updatedRoom = await hostFetch("/settings", "PATCH", {
          revealTargetNames: nextValue,
        });
        if (updatedRoom) setRoom(updatedRoom);
      } catch (requestError) {
        setRoom(previousRoom);
        throw requestError;
      }
    });
  };

  const advance = () => {
    if (!room?.currentCard) return;
    void perform("next", async () => {
      const updatedRoom = await hostFetch("/next");
      if (updatedRoom) setRoom(updatedRoom);
      else await refresh();
    });
  };

  const deleteRoom = () => {
    void perform("delete", async () => {
      await hostFetch("", "DELETE");
      window.sessionStorage.removeItem(`ratok-vall-host-${code}`);
      window.location.assign("/");
    });
  };

  const total = room ? getTotalSubmissions(room) : 0;
  const lastCard = Boolean(
    room?.currentCard &&
      (room.currentCard.index ?? room.currentIndex ?? 0) >=
        (room.currentCard.total ?? total) - 1,
  );
  const currentPosition = useMemo(
    () => (room?.currentCard?.index ?? room?.currentIndex ?? 0) + 1,
    [room?.currentCard?.index, room?.currentIndex],
  );

  const checkingHostAccess =
    hostToken === null || (hostToken === "" && accountHostAccess === null);

  if ((loading && !room) || checkingHostAccess) {
    return (
      <main className="game-shell">
        <GameHeader />
        <LoadingView label="A házigazda nézet betöltése…" />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="game-shell">
        <GameHeader />
        <ErrorView title="Ez a játék már nem érhető el" message="Lehet, hogy lejárt, vagy korábban törölték." />
      </main>
    );
  }

  if (hostToken === "" && accountHostAccess === false) {
    return (
      <main className="game-shell">
        <GameHeader />
        <ErrorView
          title="Nincs hozzáférésed ehhez a játékhoz"
          message="Jelentkezz be a játék tulajdonosának fiókjával, vagy nyisd meg az eredeti házigazda-hivatkozást."
        />
      </main>
    );
  }

  if (!room) {
    return (
      <main className="game-shell">
        <GameHeader />
        <ErrorView message={error || undefined} onRetry={() => void refresh()} />
      </main>
    );
  }

  const gameStarted = room.status !== "collecting";

  return (
    <main className={`game-shell host-shell${gameStarted ? " game-shell-immersive" : ""}`}>
      {gameStarted ? null : (
        <GameHeader aside={<span className="host-badge">Házigazda</span>} />
      )}
      <div className="game-content host-content">
        {gameStarted ? (
          <h1 className="sr-only">{room.title || "Névtelen kör"}</h1>
        ) : (
          <HostRoomHeading room={room} />
        )}

        {error ? <div className="connection-note" role="status">A frissítés akadozik. Újra próbálkozunk…</div> : null}
        {actionError ? <div className="form-error action-error" role="alert"><span aria-hidden="true">!</span><p>{actionError}</p></div> : null}

        {room.status === "collecting" ? (
          <div className="host-grid">
            <HostPanel eyebrow="Meghívás" title="Küldd el a társaságnak" className="share-panel">
              <p className="panel-lead">Ezzel a hivatkozással bárki név nélkül írhat a játékba.</p>
              <label className="sr-only" htmlFor="invite-link">Meghívó hivatkozás</label>
              <input className="share-link-input" id="invite-link" readOnly value={inviteUrl} />
              <ShareControls url={inviteUrl} />
              <div className="host-only-note">
                <span aria-hidden="true">i</span>
                <p>Ezt a házigazda-oldalt ne oszd meg; innen irányítod a játékot.</p>
              </div>
            </HostPanel>

            <HostPanel eyebrow="Állapot" title="Gyűlnek a mondatok" className="count-panel">
              <div className="submission-total" aria-live="polite">
                <strong>{room.submissionCount}</strong>
                <span>beérkezett mondat</span>
              </div>
              <p className="panel-lead">A tartalmukat csak a játék indításakor látod.</p>
              <button
                className="button button-primary button-full"
                disabled={!room.submissionCount || busy !== null}
                onClick={() => void runAndUpdate("start", "/start")}
                type="button"
              >
                {busy === "start" ? "Indítás…" : "Beküldés lezárása és indítás"}
                {busy !== "start" ? <span aria-hidden="true">→</span> : null}
              </button>
              {!room.submissionCount ? <p className="button-help">Legalább egy mondat kell az indításhoz.</p> : null}
            </HostPanel>

            <HostPanel eyebrow="Beállítások" title="A felfedés módja" className="settings-panel">
              <label className="switch-card switch-card-flat" htmlFor="host-target-reveal">
                <span>
                  <strong>Célpont megnevezése</strong>
                  <small>
                    {room.revealTargetNames
                      ? "A mondat után külön felfedhető, kire gondoltak."
                      : "A célpont a játék végén sem jelenik meg."}
                  </small>
                </span>
                <span className="switch-control">
                  <input
                    checked={room.revealTargetNames}
                    disabled={busy === "settings"}
                    id="host-target-reveal"
                    onChange={(event) => updateRevealSetting(event.target.checked)}
                    role="switch"
                    type="checkbox"
                  />
                  <span aria-hidden="true" />
                </span>
              </label>
              <div className="target-list" aria-label="A játék célpontjai">
                {room.participants.map((participant) => <span key={participant.id}>{participant.name}</span>)}
              </div>
              <p className="settings-footnote">A célpontok névsora a létrehozás után már nem módosítható.</p>
            </HostPanel>
          </div>
        ) : null}

        {room.status === "playing" ? (
          <section className="host-play-stage">
            <div className="progress-row">
              <span>{currentPosition}. mondat</span>
              <div className="host-progress-actions">
                <span>{total} összesen</span>
                <button
                  aria-controls="finish-game-dialog"
                  aria-haspopup="dialog"
                  className="button button-quiet game-finish-trigger"
                  disabled={busy !== null}
                  onClick={() => finishDialogRef.current?.showModal()}
                  type="button"
                >
                  Befejezés
                </button>
              </div>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${total ? (currentPosition / total) * 100 : 0}%` }} />
            </div>

            {room.currentCard ? (
              <article className="reveal-card host-reveal-card">
                <span className="large-quote" aria-hidden="true">“</span>
                <p className="reveal-label">Olvassátok fel</p>
                <h2 ref={cardTitleRef} tabIndex={-1}>{room.currentCard.body}</h2>

                {room.revealTargetNames && isTargetRevealed(room.currentCard) && getTargetName(room.currentCard) ? (
                  <div className="target-reveal">
                    <span>Erre a személyre gondoltak</span>
                    <strong>{getTargetName(room.currentCard)}</strong>
                  </div>
                ) : (
                  <p className="guess-prompt">
                    {room.revealTargetNames
                      ? "Előbb tippeljetek, aztán fedjétek fel a célpontot."
                      : "Beszéljétek meg, kire illik a legjobban."}
                  </p>
                )}
              </article>
            ) : <LoadingView label="A következő mondat betöltése…" />}

            {room.revealTargetNames && room.currentCard && !room.currentCard.targetRevealed ? (
              <div className="play-controls">
                <button
                  className="button button-primary button-large"
                  disabled={busy !== null}
                  onClick={() => void runAndUpdate("reveal", "/reveal")}
                  type="button"
                >
                  {busy === "reveal" ? "Felfedés…" : "Célpont felfedése"}
                </button>
              </div>
            ) : !lastCard ? (
              <div className="play-controls">
                <button
                  className="button button-primary button-large"
                  disabled={busy !== null || !room.currentCard}
                  onClick={advance}
                  type="button"
                >
                  {busy === "next" ? "Következő…" : "Következő mondat"}
                  {busy !== "next" ? <span aria-hidden="true">→</span> : null}
                </button>
              </div>
            ) : null}

            <dialog
              aria-describedby="finish-dialog-description"
              aria-labelledby="finish-dialog-title"
              aria-modal="true"
              className="finish-dialog"
              id="finish-game-dialog"
              ref={finishDialogRef}
            >
              <div className="finish-dialog-body">
                <span className="finish-dialog-symbol" aria-hidden="true">!</span>
                <p className="eyebrow">Játék befejezése</p>
                <h2 id="finish-dialog-title">Biztosan befejezed a játékot?</h2>
                <p id="finish-dialog-description">
                  A játékosok a befejezett képernyőre kerülnek. A játékot később
                  ugyaninnen, az összes mondattal újraindíthatod.
                </p>
              </div>
              <form className="finish-dialog-actions" method="dialog">
                <button autoFocus className="button button-secondary" value="cancel">
                  Mégsem
                </button>
                <button
                  className="button button-danger"
                  disabled={busy !== null}
                  onClick={() => {
                    finishDialogRef.current?.close();
                    void runAndUpdate("finish", "/finish");
                  }}
                  type="button"
                >
                  Igen, befejezem
                </button>
              </form>
            </dialog>
          </section>
        ) : null}

        {room.status === "finished" ? (
          <section className="success-card host-finished-card" aria-labelledby="host-finished-title">
            <div className="finish-confetti" aria-hidden="true">✦</div>
            <p className="eyebrow">Vége a körnek</p>
            <h2 id="host-finished-title" ref={finishedTitleRef} tabIndex={-1}>
              Szép játék volt!
            </h2>
            <p>
              {room.submissionCount} névtelen mondat vár egy újabb, frissen
              megkevert körre.
            </p>
            <div className="finished-actions">
              <button
                className="button button-primary"
                disabled={busy !== null}
                onClick={() => void runAndUpdate("restart", "/restart")}
                type="button"
              >
                {busy === "restart" ? "Újraindítás…" : "Játék újrajátszása"}
              </button>
              <a className="button button-secondary" href="/">Vissza a fiókomhoz</a>
            </div>
          </section>
        ) : null}

        {room.status === "collecting" ? (
          <section className="danger-zone" aria-labelledby="danger-title">
            <div>
              <h2 id="danger-title">Játék törlése</h2>
              <p>A mondatok és a játék hivatkozása végleg megszűnik.</p>
            </div>
            {confirmDelete ? (
              <div className="delete-confirm" role="alert">
                <span>Biztosan törlöd?</span>
                <button className="button button-danger" disabled={busy !== null} onClick={deleteRoom} type="button">
                  {busy === "delete" ? "Törlés…" : "Igen, törlöm"}
                </button>
                <button className="button button-quiet" onClick={() => setConfirmDelete(false)} type="button">Mégsem</button>
              </div>
            ) : (
              <button className="button button-quiet danger-trigger" onClick={() => setConfirmDelete(true)} type="button">
                Játék törlése
              </button>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
