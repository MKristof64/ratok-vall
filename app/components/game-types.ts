export type RoomStatus = "collecting" | "playing" | "finished";

export interface Participant {
  id: string;
  name: string;
}

export interface CurrentCard {
  id?: string;
  body: string;
  index?: number;
  total?: number;
  targetId?: string | null;
  targetName?: string | null;
  targetRevealed?: boolean;
  revealed?: boolean;
}

export interface GameRoom {
  code?: string;
  title: string;
  status: RoomStatus;
  revealTargetNames: boolean;
  participants: Participant[];
  submissionCount?: number;
  totalSubmissions?: number;
  currentIndex?: number;
  currentCard?: CurrentCard | null;
  version?: number;
}

export interface RoomResponse {
  room: GameRoom;
}

export interface CreateRoomResponse extends RoomResponse {
  code?: string;
  hostToken: string;
}

export async function getApiError(
  response: Response,
  fallback = "Valami nem sikerült. Próbáld újra.",
) {
  try {
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return payload.error || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export function getTargetName(card?: CurrentCard | null) {
  return typeof card?.targetName === "string" && card.targetName.trim()
    ? card.targetName
    : null;
}

export function isTargetRevealed(card?: CurrentCard | null) {
  if (!card) return false;
  if (typeof card.targetRevealed === "boolean") return card.targetRevealed;
  if (typeof card.revealed === "boolean") return card.revealed;
  return Boolean(getTargetName(card));
}

export function getTotalSubmissions(room: GameRoom) {
  return room.totalSubmissions ?? room.currentCard?.total ?? room.submissionCount ?? 0;
}
