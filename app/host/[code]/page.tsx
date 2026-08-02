import type { Metadata } from "next";
import { HostRoom } from "../../components/HostRoom";

export const metadata: Metadata = {
  title: "Házigazda",
};

export default async function HostPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <HostRoom code={code} />;
}
