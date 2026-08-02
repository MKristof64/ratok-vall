import { getD1 } from "@/db";
import { randomToken, sha256Hex } from "@/lib/room-crypto";
import { ensureRoomSchema } from "@/lib/room-db";
import {
  type CreateRoomInput,
  RoomRequestError,
  type SettingsInput,
  requireHostToken,
  requireRoomCode,
} from "@/lib/room-validation";

export type RoomStatus = "collecting" | "playing" | "finished";

const MAX_SUBMISSIONS_PER_ROOM = 300;

interface RoomRow {
  id: string;
  title: string;
  status: RoomStatus;
  reveal_target_names: number;
  current_card_index: number;
  current_target_revealed: number;
  version: number;
}

interface ParticipantRow {
  id: string;
  display_name: string;
}

interface CountRow {
  count: number;
}

interface CurrentCardRow {
  id: string;
  body: string;
  target_participant_id: string;
  target_name: string;
}

export interface PublicRoomState {
  code: string;
  title: string;
  status: RoomStatus;
  revealTargetNames: boolean;
  participants: Array<{ id: string; name: string }>;
  submissionCount: number;
  currentIndex: number;
  currentCard:
    | ({
        id: string;
        body: string;
        index: number;
        total: number;
        targetRevealed: boolean;
      } & Partial<{ targetId: string; targetName: string }>)
    | null;
  version: number;
}

async function roomHash(code: string) {
  return sha256Hex(requireRoomCode(code));
}

async function findRoomByCode(code: string) {
  await ensureRoomSchema();
  const d1 = getD1();
  const shareCodeHash = await roomHash(code);
  const room = await d1
    .prepare(
      `SELECT id, title, status, reveal_target_names, current_card_index,
              current_target_revealed, version
       FROM rooms
       WHERE share_code_hash = ?
       LIMIT 1`,
    )
    .bind(shareCodeHash)
    .first<RoomRow>();
  if (!room) {
    throw new RoomRequestError(404, "room_not_found", "A szoba nem található.");
  }
  return room;
}

async function authorizeHost(code: string, rawHostToken: string | null) {
  await ensureRoomSchema();
  const d1 = getD1();
  const [shareCodeHash, hostTokenHash] = await Promise.all([
    roomHash(code),
    sha256Hex(requireHostToken(rawHostToken)),
  ]);
  const room = await d1
    .prepare(
      `SELECT id, title, status, reveal_target_names, current_card_index,
              current_target_revealed, version
       FROM rooms
       WHERE share_code_hash = ? AND host_token_hash = ?
       LIMIT 1`,
    )
    .bind(shareCodeHash, hostTokenHash)
    .first<RoomRow>();
  if (!room) {
    throw new RoomRequestError(
      403,
      "host_unauthorized",
      "Érvénytelen házigazda-jogosultság.",
    );
  }
  return room;
}

async function submissionCount(roomId: string) {
  const row = await getD1()
    .prepare("SELECT COUNT(*) AS count FROM submissions WHERE room_id = ?")
    .bind(roomId)
    .first<CountRow>();
  return Number(row?.count ?? 0);
}

export async function getPublicRoom(code: string): Promise<PublicRoomState> {
  const room = await findRoomByCode(code);
  const d1 = getD1();
  const [participantResult, total] = await Promise.all([
    d1
      .prepare(
        `SELECT id, display_name
         FROM participants
         WHERE room_id = ?
         ORDER BY sort_order ASC`,
      )
      .bind(room.id)
      .all<ParticipantRow>(),
    submissionCount(room.id),
  ]);

  const targetRevealed = room.current_target_revealed === 1;
  let currentCard: PublicRoomState["currentCard"] = null;
  if (
    room.status === "playing" &&
    room.current_card_index >= 0 &&
    room.current_card_index < total
  ) {
    const card = await d1
      .prepare(
        `SELECT s.id, s.body, s.target_participant_id,
                p.display_name AS target_name
         FROM submissions AS s
         INNER JOIN participants AS p
           ON p.id = s.target_participant_id AND p.room_id = s.room_id
         WHERE s.room_id = ?
         ORDER BY s.reveal_sort_key ASC
         LIMIT 1 OFFSET ?`,
      )
      .bind(room.id, room.current_card_index)
      .first<CurrentCardRow>();
    if (card) {
      currentCard = {
        id: card.id,
        body: card.body,
        index: room.current_card_index,
        total,
        targetRevealed,
      };
      if (targetRevealed && room.reveal_target_names === 1) {
        currentCard.targetId = card.target_participant_id;
        currentCard.targetName = card.target_name;
      }
    }
  }

  return {
    code,
    title: room.title,
    status: room.status,
    revealTargetNames: room.reveal_target_names === 1,
    participants: participantResult.results.map((participant: ParticipantRow) => ({
      id: participant.id,
      name: participant.display_name,
    })),
    submissionCount: total,
    currentIndex: room.status === "playing" ? room.current_card_index : -1,
    currentCard,
    version: room.version,
  };
}

export async function createRoom(input: CreateRoomInput) {
  await ensureRoomSchema();
  const d1 = getD1();
  const id = crypto.randomUUID();
  const code = randomToken(32);
  const hostToken = randomToken(32);
  const [shareCodeHash, hostTokenHash] = await Promise.all([
    sha256Hex(code),
    sha256Hex(hostToken),
  ]);

  const statements = [
    d1
      .prepare(
        `INSERT INTO rooms (
           id, share_code_hash, host_token_hash, title, status,
           reveal_target_names, current_card_index,
           current_target_revealed, version
         ) VALUES (?, ?, ?, ?, 'collecting', ?, -1, 0, 1)`,
      )
      .bind(
        id,
        shareCodeHash,
        hostTokenHash,
        input.title,
        input.revealTargetNames ? 1 : 0,
      ),
    ...input.participants.map((participant, index) =>
      d1
        .prepare(
          `INSERT INTO participants (
             id, room_id, display_name, normalized_name, sort_order
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          participant.displayName,
          participant.normalizedName,
          index,
        ),
    ),
  ];
  await d1.batch(statements);

  return { code, hostToken, room: await getPublicRoom(code) };
}

export async function addSubmission(
  code: string,
  input: { body: string; targetId: string; submissionKey: string },
) {
  const room = await findRoomByCode(code);
  const d1 = getD1();
  const submissionKeyHash = await sha256Hex(input.submissionKey);

  const existing = await d1
    .prepare(
      `SELECT id
       FROM submissions
       WHERE room_id = ? AND submission_key_hash = ?
       LIMIT 1`,
    )
    .bind(room.id, submissionKeyHash)
    .first<{ id: string }>();
  if (existing) {
    return {
      submission: { id: existing.id },
      created: false,
      submissionCount: await submissionCount(room.id),
    };
  }

  const submissionId = crypto.randomUUID();
  const revealSortKey = randomToken(32);
  const inserted = await d1
    .prepare(
      `INSERT INTO submissions (
         id, room_id, target_participant_id, body,
         submission_key_hash, reveal_sort_key
       )
       SELECT ?, r.id, p.id, ?, ?, ?
       FROM rooms AS r
       INNER JOIN participants AS p
         ON p.room_id = r.id AND p.id = ?
       WHERE r.id = ? AND r.status = 'collecting'
         AND (
           SELECT COUNT(*)
           FROM submissions AS room_submissions
           WHERE room_submissions.room_id = r.id
         ) < ?
       ON CONFLICT (room_id, submission_key_hash) DO NOTHING
       RETURNING id`,
    )
    .bind(
      submissionId,
      input.body,
      submissionKeyHash,
      revealSortKey,
      input.targetId,
      room.id,
      MAX_SUBMISSIONS_PER_ROOM,
    )
    .all<{ id: string }>();

  const insertedRow = inserted.results[0];
  if (insertedRow) {
    return {
      submission: { id: insertedRow.id },
      created: true,
      submissionCount: await submissionCount(room.id),
    };
  }

  const duplicate = await d1
    .prepare(
      `SELECT id
       FROM submissions
       WHERE room_id = ? AND submission_key_hash = ?
       LIMIT 1`,
    )
    .bind(room.id, submissionKeyHash)
    .first<{ id: string }>();
  if (duplicate) {
    return {
      submission: { id: duplicate.id },
      created: false,
      submissionCount: await submissionCount(room.id),
    };
  }

  const latestRoom = await d1
    .prepare(
      `SELECT r.status,
              (SELECT COUNT(*) FROM submissions AS s WHERE s.room_id = r.id)
                AS submission_count,
              EXISTS(
                SELECT 1 FROM participants AS p
                WHERE p.room_id = r.id AND p.id = ?
              ) AS target_exists
       FROM rooms AS r
       WHERE r.id = ?
       LIMIT 1`,
    )
    .bind(input.targetId, room.id)
    .first<{
      status: RoomStatus;
      submission_count: number;
      target_exists: number;
    }>();
  if (!latestRoom || latestRoom.status !== "collecting") {
    throw new RoomRequestError(
      409,
      "submissions_closed",
      "Ebben a szobában már lezárult a beküldés.",
    );
  }
  if (latestRoom.target_exists !== 1) {
    throw new RoomRequestError(
      400,
      "invalid_target",
      "A kiválasztott célpont nem tartozik ehhez a szobához.",
    );
  }
  if (Number(latestRoom.submission_count) >= MAX_SUBMISSIONS_PER_ROOM) {
    throw new RoomRequestError(
      409,
      "room_submission_limit",
      "A szoba elérte a 300 mondatos korlátot.",
    );
  }
  throw new RoomRequestError(
    409,
    "submission_conflict",
    "A mondat most nem küldhető be. Próbáld újra.",
  );
}

export async function updateRoomSettings(
  code: string,
  rawHostToken: string | null,
  input: SettingsInput,
) {
  const room = await authorizeHost(code, rawHostToken);
  if (room.status !== "collecting") {
    throw new RoomRequestError(
      409,
      "settings_locked",
      "A beállítások a játék indítása után már nem módosíthatók.",
    );
  }

  const result = await getD1()
    .prepare(
      `UPDATE rooms
       SET title = ?, reveal_target_names = ?, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'collecting' AND version = ?`,
    )
    .bind(
      input.title ?? room.title,
      input.revealTargetNames === undefined
        ? room.reveal_target_names
        : input.revealTargetNames
          ? 1
          : 0,
      room.id,
      room.version,
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new RoomRequestError(
      409,
      "room_changed",
      "A szoba közben megváltozott. Próbáld újra.",
    );
  }
  return getPublicRoom(code);
}

export async function startRoom(code: string, rawHostToken: string | null) {
  const room = await authorizeHost(code, rawHostToken);
  if (room.status !== "collecting") {
    throw new RoomRequestError(409, "already_started", "A játék már elindult.");
  }
  if ((await submissionCount(room.id)) === 0) {
    throw new RoomRequestError(
      409,
      "no_submissions",
      "A játék indításához legalább egy mondat szükséges.",
    );
  }
  const result = await getD1()
    .prepare(
      `UPDATE rooms
       SET status = 'playing', current_card_index = 0,
           current_target_revealed = 0, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'collecting' AND version = ?
         AND EXISTS (SELECT 1 FROM submissions WHERE room_id = rooms.id)`,
    )
    .bind(room.id, room.version)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new RoomRequestError(
      409,
      "room_changed",
      "A szoba közben megváltozott. Próbáld újra.",
    );
  }
  return getPublicRoom(code);
}

export async function revealCurrentTarget(
  code: string,
  rawHostToken: string | null,
) {
  const room = await authorizeHost(code, rawHostToken);
  if (room.status !== "playing") {
    throw new RoomRequestError(
      409,
      "not_playing",
      "A játék nincs felfedési állapotban.",
    );
  }
  if (room.current_target_revealed === 0) {
    const result = await getD1()
      .prepare(
        `UPDATE rooms
         SET current_target_revealed = 1, version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'playing' AND version = ?
           AND current_target_revealed = 0`,
      )
      .bind(room.id, room.version)
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new RoomRequestError(
        409,
        "room_changed",
        "A szoba közben megváltozott. Próbáld újra.",
      );
    }
  }
  return getPublicRoom(code);
}

export async function nextCard(code: string, rawHostToken: string | null) {
  const room = await authorizeHost(code, rawHostToken);
  if (room.status !== "playing") {
    throw new RoomRequestError(
      409,
      "not_playing",
      "A játék nincs felfedési állapotban.",
    );
  }
  if (room.reveal_target_names === 1 && room.current_target_revealed !== 1) {
    throw new RoomRequestError(
      409,
      "reveal_first",
      "Előbb fedd fel az aktuális mondat célpontját.",
    );
  }
  const total = await submissionCount(room.id);
  if (room.current_card_index + 1 >= total) {
    throw new RoomRequestError(
      409,
      "last_card",
      "Ez volt az utolsó mondat. Fejezd be a játékot.",
    );
  }
  const result = await getD1()
    .prepare(
      `UPDATE rooms
       SET current_card_index = current_card_index + 1,
           current_target_revealed = 0, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'playing' AND version = ?
         AND (reveal_target_names = 0 OR current_target_revealed = 1)`,
    )
    .bind(room.id, room.version)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new RoomRequestError(
      409,
      "room_changed",
      "A szoba közben megváltozott. Próbáld újra.",
    );
  }
  return getPublicRoom(code);
}

export async function finishRoom(code: string, rawHostToken: string | null) {
  const room = await authorizeHost(code, rawHostToken);
  if (room.status !== "playing") {
    throw new RoomRequestError(
      409,
      "not_playing",
      "Csak folyamatban lévő játék fejezhető be.",
    );
  }
  const result = await getD1()
    .prepare(
      `UPDATE rooms
       SET status = 'finished', current_card_index = -1,
           current_target_revealed = 0, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'playing' AND version = ?`,
    )
    .bind(room.id, room.version)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new RoomRequestError(
      409,
      "room_changed",
      "A szoba közben megváltozott. Próbáld újra.",
    );
  }
  return getPublicRoom(code);
}

export async function deleteRoom(code: string, rawHostToken: string | null) {
  const room = await authorizeHost(code, rawHostToken);
  await getD1()
    .prepare("DELETE FROM rooms WHERE id = ?")
    .bind(room.id)
    .run();
}
