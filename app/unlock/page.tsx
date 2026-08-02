import type { Metadata } from "next";
import { Brand } from "../components/AppChrome";
import { UnlockForm } from "../components/UnlockForm";

export const metadata: Metadata = {
  title: "Belépés",
};

export default function UnlockPage() {
  return (
    <main className="unlock-page">
      <header className="unlock-header"><Brand /></header>
      <div className="unlock-wrap">
        <UnlockForm />
        <p className="unlock-privacy">
          Nem kérünk nevet, e-mail-címet vagy felhasználói fiókot.
        </p>
      </div>
    </main>
  );
}
