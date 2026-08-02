import type { Metadata } from "next";
import { AccountLink, AppFooter, Brand } from "./components/AppChrome";
import { CreateGameForm } from "./components/CreateGameForm";

export const metadata: Metadata = {
  title: "Új játék",
  description:
    "Anonim társasági játék, ahol egy-egy mondatból kell ráismernetek egymásra.",
};

export default function Home() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions home-topbar-actions">
          <span className="privacy-chip">Névtelen beküldés</span>
          <AccountLink />
        </div>
      </header>

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="eyebrow">Anonim társasági játék</p>
          <h1 id="home-title">Egy mondat. Egy ismerős. Sok nevetés.</h1>
          <p className="hero-lead">
            Írjatok egymásról találó mondatokat név nélkül, aztán derítsétek
            ki együtt, kire gondolhatott a beküldő.
          </p>
          <div className="trust-row" aria-label="A játék fő előnyei">
            <span>Fiók nélkül beküldhető</span>
            <span>Névtelen mondatok</span>
            <span>Egyetlen linkkel</span>
          </div>
        </div>

        <CreateGameForm />
      </section>

      <AppFooter />
    </main>
  );
}
