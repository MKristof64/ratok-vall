import type { Metadata } from "next";
import { AppFooter, Brand } from "./components/AppChrome";
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
        <span className="privacy-chip">Nincs regisztráció</span>
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
            <span>Fiók nélkül</span>
            <span>Anonim beküldés</span>
            <span>Egyetlen linkkel</span>
          </div>
        </div>

        <CreateGameForm />
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <div className="section-heading">
          <p className="eyebrow">Így működik</p>
          <h2 id="how-title">Három egyszerű lépés</h2>
        </div>
        <ol className="steps-grid">
          <li className="step-card">
            <span className="step-number">1</span>
            <h3>Állítsd össze</h3>
            <p>Add meg a társaság tagjainak nevét vagy becenevét.</p>
          </li>
          <li className="step-card">
            <span className="step-number">2</span>
            <h3>Oszd meg</h3>
            <p>Küldd el a meghívót. Mindenki név nélkül írhat mondatokat.</p>
          </li>
          <li className="step-card">
            <span className="step-number">3</span>
            <h3>Fedjétek fel</h3>
            <p>Olvassátok végig a kártyákat, és találjátok ki, kiről szólnak.</p>
          </li>
        </ol>
      </section>

      <section className="privacy-note" aria-labelledby="privacy-title">
        <div className="privacy-symbol" aria-hidden="true">•••</div>
        <div>
          <h2 id="privacy-title">A mondat számít, nem az, ki írta.</h2>
          <p>
            Nem kérünk nevet, e-mail-címet vagy felhasználói fiókot. A
            beküldő személye nem jelenik meg a játékban.
          </p>
        </div>
      </section>

      <AppFooter />
    </main>
  );
}
