import type { Metadata } from "next";
import { AccountClient } from "../components/AccountClient";

export const metadata: Metadata = {
  title: "Fiókom",
};

export default function AccountPage() {
  return <AccountClient />;
}
