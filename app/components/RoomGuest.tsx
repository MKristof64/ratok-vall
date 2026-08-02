"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ErrorView, GameHeader, LoadingView, StatusPill } from "./AppChrome";
import { ShareControls } from "./ShareControls";
import {
  getApiError,
  getTargetName,
  getTotalSubmissions,
  isTargetRevealed,
} from "./game-types";
import { useRoomPolling } from "./useRoomPolling";

const MAX_BODY_LENGTH = 180;

function makeSubmissionKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function RoomStatusHeader({
  title,
  status,
}: {
  title: string;
  status: "collecting" | "playing" | "finished";
}) {
  const labels = {
    collecting: "Fogadja a mondatokat",
    playing: "Játékban",
    finished: "Befejezve",
  };
  return (
    <div className="room-title-row">
      <div>
        <p className="room-kicker">Közös játék</p>
        <h1>{title || "Névtelen kör"}</h1>
      </div>
      <StatusPill tone={status === "playing" ? "live" : status === "finished" ? "done" : "neutral"}>
        {labels[status]}
      </StatusPill>
    </div>
  );
}

export function RoomGuest({ code }: { code: string }) {
  const { room, loading, error, notFound, refresh } = useRoomPolling(code);
  const [body, setBody] = useState("");
  const [targetId, setTargetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const cardTitleRef = useRef<HTMLHeadingElement>(null);
  const submissionKeyRef = useRef<string | null>(null);

  const cardKey = `${room?.currentIndex ?? -1}:${room?.currentCard?.id ?? "none"}`;
  const shouldFocusCard = room?.status === "playing" && Boolean(room.currentCard);

  useEffect(() => {
    setInviteUrl(window.location.href.split("#")[0]);
  }, []);

  useEffect(() => {
    if (shouldFocusCard) {
      cardTitleRef.current?.focus();
    }
  }, [cardKey, shouldFocusCard]);

  useEffect(() => {
    if (room && targetId && !room.participants.some((participant) => participant.id === targetId)) {
      setTargetId("");
    }
  }, [room, targetId]);

  const targetHelper = useMemo(() => {
    if (!room) return "";
    return room.revealTargetNames
      ? "A választás csak a felfedéskor jelenik meg."
      : "A választás ebben a játékban nem jelenik meg a végén.";
  }, [room]);

  const submitSentence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    const cleanBody = body.trim();

    if (!cleanBody) {
      setSubmitError("Írj egy mondatot a beküldéshez.");
      return;
    }
    if (!targetId) {
      setSubmitError("Válaszd ki, kire gondoltál.");
      return;
    }

    setSubmitting(true);
    const storageKey = `ratok-vall-submission-${code}`;
    let submissionKey = submissionKeyRef.current;
    if (!submissionKey) {
      submissionKey = window.sessionStorage.getItem(storageKey) || makeSubmissionKey();
      submissionKeyRef.current = submissionKey;
      window.sessionStorage.setItem(storageKey, submissionKey);
    }

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/submissions`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ body: cleanBody, targetId, submissionKey }),
      });

      if (response.status === 401) {
        window.location.replace(
          `/unlock?returnTo=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      if (response.status === 409) {
        await refresh();
        throw new Error("A beküldés időközben lezárult.");
      }
      if (!response.ok) throw new Error(await getApiError(response));

      window.sessionStorage.removeItem(storageKey);
      submissionKeyRef.current = null;
      setBody("");
      setTargetId("");
      setSubmitted(true);
      await refresh();
    } catch (requestError) {
      setSubmitError(
        requestError instanceof Error
          ? requestError.message
          : "A mondat most nem küldhető be. Próbáld újra.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !room) {
    return (
      <main className="game-shell">
        <GameHeader />
        <LoadingView label="A játék betöltése…" />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="game-shell">
        <GameHeader />
        <ErrorView
          title="Ez a játék már nem érhető el"
          message="Lehet, hogy a meghívó lejárt, vagy a játékot törölték."
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

  const total = getTotalSubmissions(room);

  return (
    <main className="game-shell">
      <GameHeader aside={inviteUrl ? <ShareControls compact url={inviteUrl} /> : null} />
      <div className="game-content">
        <RoomStatusHeader title={room.title} status={room.status} />

        {error ? (
          <div className="connection-note" role="status">
            A legutóbbi frissítés nem sikerült. Újra próbálkozunk…
          </div>
        ) : null}

        {room.status === "collecting" ? (
          submitted ? (
            <section className="success-card" aria-labelledby="success-title">
              <div className="success-mark" aria-hidden="true">✓</div>
              <p className="eyebrow">Beküldve</p>
              <h2 id="success-title">Megérkezett!</h2>
              <p>A mondatod név nélkül bekerült a játékba.</p>
              <button className="button button-primary" onClick={() => setSubmitted(false)} type="button">
                Írok még egyet
              </button>
              <p className="quiet-count">Eddig {room.submissionCount} mondat érkezett.</p>
            </section>
          ) : (
            <section className="submission-layout" aria-labelledby="submission-title">
              <form className="submission-card" onSubmit={submitSentence} noValidate>
                <div className="submission-heading">
                  <span className="card-quote" aria-hidden="true">“</span>
                  <div>
                    <p className="eyebrow">Névtelen beküldés</p>
                    <h2 id="submission-title">Írj egy mondatot</h2>
                  </div>
                </div>
                <p className="submission-lead">
                  Fogalmazz úgy, hogy felismerhető legyen valaki a társaságból.
                  A neved nem kerül a mondat mellé.
                </p>

                {submitError ? <div className="form-error" role="alert"><span aria-hidden="true">!</span><p>{submitError}</p></div> : null}

                <div className="field-group">
                  <div className="field-label-row">
                    <label htmlFor="sentence">A mondatod</label>
                    <span id="sentence-count">{body.length}/{MAX_BODY_LENGTH}</span>
                  </div>
                  <textarea
                    aria-describedby="sentence-count"
                    id="sentence"
                    maxLength={MAX_BODY_LENGTH}
                    onChange={(event) => {
                      setBody(event.target.value);
                      setSubmitError(null);
                    }}
                    placeholder="Például: Mindig tudja, hol van a legjobb süti."
                    rows={5}
                    value={body}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="target">Kire gondoltál?</label>
                  <select
                    id="target"
                    onChange={(event) => {
                      setTargetId(event.target.value);
                      setSubmitError(null);
                    }}
                    value={targetId}
                  >
                    <option value="">Válassz célpontot</option>
                    {room.participants.map((participant) => (
                      <option key={participant.id} value={participant.id}>{participant.name}</option>
                    ))}
                  </select>
                  <p className="field-help">{targetHelper}</p>
                </div>

                <button className="button button-primary button-full" disabled={submitting} type="submit">
                  {submitting ? "Beküldés…" : "Mondat beküldése"}
                  {!submitting ? <span aria-hidden="true">→</span> : null}
                </button>
                <p className="kindness-note">Kérjük, ne írj érzékeny vagy bántó tartalmat.</p>
              </form>

              <aside className="waiting-card">
                <span className="waiting-count">{room.submissionCount}</span>
                <strong>{room.submissionCount === 1 ? "mondat érkezett" : "mondat érkezett"}</strong>
                <p>A házigazda jelzi, amikor indul a felfedés.</p>
              </aside>
            </section>
          )
        ) : null}

        {room.status === "playing" ? (
          <section className="play-stage" aria-live="polite">
            <div className="progress-row">
              <span>{(room.currentIndex ?? 0) + 1}. mondat</span>
              <span>{total} összesen</span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${total ? (((room.currentIndex ?? 0) + 1) / total) * 100 : 0}%` }} />
            </div>

            {room.currentCard ? (
              <article className="reveal-card guest-reveal-card">
                <span className="large-quote" aria-hidden="true">“</span>
                <h2 ref={cardTitleRef} tabIndex={-1}>{room.currentCard.body}</h2>
                {room.revealTargetNames && isTargetRevealed(room.currentCard) && getTargetName(room.currentCard) ? (
                  <div className="target-reveal">
                    <span>Erre a személyre gondoltak</span>
                    <strong>{getTargetName(room.currentCard)}</strong>
                  </div>
                ) : (
                  <p className="waiting-for-host">
                    {room.revealTargetNames
                      ? "Tippeljetek! A házigazda hamarosan felfedi a célpontot."
                      : "Beszéljétek meg együtt, kire illik a legjobban."}
                  </p>
                )}
              </article>
            ) : (
              <LoadingView label="A következő mondatra várunk…" />
            )}
            <p className="host-controls-note">A játékot a házigazda irányítja.</p>
          </section>
        ) : null}

        {room.status === "finished" ? (
          <section className="success-card finished-card" aria-labelledby="finished-title">
            <div className="finish-confetti" aria-hidden="true">✦</div>
            <p className="eyebrow">A kör véget ért</p>
            <h2 id="finished-title">Köszönjük a mondatokat!</h2>
            <p>{room.submissionCount} névtelen mondatból született közös játék.</p>
            <a className="button button-primary" href="/">Új játék indítása</a>
          </section>
        ) : null}
      </div>
    </main>
  );
}
