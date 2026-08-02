import type { Metadata } from "next";
import { RoomGuest } from "../../components/RoomGuest";

export const metadata: Metadata = {
  title: "Meghívó",
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <RoomGuest code={code} />;
}
