import type { Metadata } from "next";
import { AccountClient } from "./components/AccountClient";

export const metadata: Metadata = {
  title: "Fiókom",
  description: "Saját játékok létrehozása és kezelése egy helyen.",
};

export default function Home() {
  return <AccountClient />;
}
