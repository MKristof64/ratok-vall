export class RoomRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoomRequestError";
  }
}

export interface CreateRoomInput {
  title: string;
  participants: Array<{ displayName: string; normalizedName: string }>;
  revealTargetNames: boolean;
}

export interface SettingsInput {
  title?: string;
  revealTargetNames?: boolean;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoomRequestError(400, "invalid_body", "Érvénytelen kérés.");
  }
  return value as Record<string, unknown>;
}

function cleanSingleLine(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTitle(value: unknown, optional: boolean) {
  if (value === undefined && optional) return undefined;
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new RoomRequestError(400, "invalid_title", "A cím csak szöveg lehet.");
  }
  const title = cleanSingleLine(value);
  if (title.length > 80) {
    throw new RoomRequestError(
      400,
      "title_too_long",
      "A cím legfeljebb 80 karakter lehet.",
    );
  }
  return title;
}

export function parseCreateRoomInput(value: unknown): CreateRoomInput {
  const body = asRecord(value);
  if (!Array.isArray(body.participants)) {
    throw new RoomRequestError(
      400,
      "invalid_participants",
      "Adj meg legalább 2 résztvevőt.",
    );
  }
  if (body.participants.length < 2 || body.participants.length > 30) {
    throw new RoomRequestError(
      400,
      "invalid_participant_count",
      "A résztvevők száma 2 és 30 között lehet.",
    );
  }

  const seen = new Set<string>();
  const participants = body.participants.map((value, index) => {
    if (typeof value !== "string") {
      throw new RoomRequestError(
        400,
        "invalid_participant",
        `A(z) ${index + 1}. résztvevő neve érvénytelen.`,
      );
    }
    const displayName = cleanSingleLine(value);
    if (!displayName || displayName.length > 40) {
      throw new RoomRequestError(
        400,
        "invalid_participant",
        "Minden név 1 és 40 karakter közötti legyen.",
      );
    }
    const normalizedName = displayName.toLocaleLowerCase("hu-HU");
    if (seen.has(normalizedName)) {
      throw new RoomRequestError(
        400,
        "duplicate_participant",
        "Minden résztvevő neve legyen különböző.",
      );
    }
    seen.add(normalizedName);
    return { displayName, normalizedName };
  });

  if (
    body.revealTargetNames !== undefined &&
    typeof body.revealTargetNames !== "boolean"
  ) {
    throw new RoomRequestError(
      400,
      "invalid_reveal_setting",
      "A célpont megnevezése beállítás érvénytelen.",
    );
  }

  return {
    title: parseTitle(body.title, false) ?? "",
    participants,
    revealTargetNames: body.revealTargetNames ?? true,
  };
}

export function parseSettingsInput(value: unknown): SettingsInput {
  const body = asRecord(value);
  const title = parseTitle(body.title, true);
  const revealTargetNames = body.revealTargetNames;
  if (
    revealTargetNames !== undefined &&
    typeof revealTargetNames !== "boolean"
  ) {
    throw new RoomRequestError(
      400,
      "invalid_reveal_setting",
      "A célpont megnevezése beállítás érvénytelen.",
    );
  }
  if (title === undefined && revealTargetNames === undefined) {
    throw new RoomRequestError(
      400,
      "empty_settings",
      "Nincs módosítható beállítás a kérésben.",
    );
  }
  return { title, revealTargetNames };
}

export function parseSubmissionInput(value: unknown) {
  const body = asRecord(value);
  if (typeof body.body !== "string") {
    throw new RoomRequestError(400, "invalid_sentence", "Írj be egy mondatot.");
  }
  const sentence = body.body
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!sentence || sentence.length > 180) {
    throw new RoomRequestError(
      400,
      "invalid_sentence",
      "A mondat 1 és 180 karakter közötti legyen.",
    );
  }
  if (typeof body.targetId !== "string" || body.targetId.length > 80) {
    throw new RoomRequestError(400, "invalid_target", "Válassz célpontot.");
  }
  if (
    typeof body.submissionKey !== "string" ||
    body.submissionKey.length < 8 ||
    body.submissionKey.length > 200
  ) {
    throw new RoomRequestError(
      400,
      "invalid_submission_key",
      "A beküldési kulcs érvénytelen.",
    );
  }
  return {
    body: sentence,
    targetId: body.targetId,
    submissionKey: body.submissionKey,
  };
}

export function requireRoomCode(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new RoomRequestError(404, "room_not_found", "A szoba nem található.");
  }
  return value;
}

export function requireHostToken(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new RoomRequestError(
      403,
      "host_unauthorized",
      "Érvénytelen házigazda-jogosultság.",
    );
  }
  return value;
}
