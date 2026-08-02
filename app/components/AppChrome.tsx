import type { ReactNode } from "react";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Rátok vall – kezdőlap">
      <span className="brand-mark" aria-hidden="true">“</span>
      <span>Rátok vall</span>
    </a>
  );
}

export function AccountLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      aria-label="Fiókom megnyitása"
      className={`account-link${compact ? " account-link-compact" : ""}`}
      href="/account"
    >
      <span className="account-link-mark" aria-hidden="true" />
      <span className="account-link-label">Fiókom</span>
    </a>
  );
}

export function GameHeader({
  aside,
  showAccountLink = true,
}: {
  aside?: ReactNode;
  showAccountLink?: boolean;
}) {
  return (
    <header className="game-topbar">
      <Brand />
      {aside || showAccountLink ? (
        <div className="topbar-actions">
          {aside}
          {showAccountLink ? <AccountLink compact /> : null}
        </div>
      ) : null}
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="footer">
      <Brand />
      <p>Névtelen mondatok, közös történetek.</p>
    </footer>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "done";
  children: ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function LoadingView({ label = "Betöltés…" }: { label?: string }) {
  return (
    <div className="center-state" role="status">
      <span className="loader" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorView({
  title = "Most nem sikerült kapcsolódni",
  message = "Ellenőrizd az internetkapcsolatot, majd próbáld újra.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="center-state error-state" role="alert">
      <div className="state-symbol" aria-hidden="true">!</div>
      <h1>{title}</h1>
      <p>{message}</p>
      {onRetry ? (
        <button className="button button-secondary" type="button" onClick={onRetry}>
          Újrapróbálom
        </button>
      ) : (
        <a className="button button-secondary" href="/">
          Vissza a kezdőlapra
        </a>
      )}
    </section>
  );
}
