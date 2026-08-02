import { getD1 } from "@/db";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY NOT NULL,
    share_code_hash TEXT NOT NULL,
    host_token_hash TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'playing', 'finished')),
    reveal_target_names INTEGER NOT NULL DEFAULT 1,
    current_card_index INTEGER NOT NULL DEFAULT -1 CHECK (current_card_index >= -1),
    current_target_revealed INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY NOT NULL,
    room_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY NOT NULL,
    room_id TEXT NOT NULL,
    target_participant_id TEXT NOT NULL,
    body TEXT NOT NULL,
    submission_key_hash TEXT NOT NULL,
    reveal_sort_key TEXT NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (target_participant_id) REFERENCES participants(id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_share_code_hash ON rooms (share_code_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_room_normalized_name ON participants (room_id, normalized_name)",
  "CREATE INDEX IF NOT EXISTS idx_participants_room_sort_order ON participants (room_id, sort_order)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_room_submission_key ON submissions (room_id, submission_key_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_room_reveal_sort_key ON submissions (room_id, reveal_sort_key)",
  "CREATE INDEX IF NOT EXISTS idx_submissions_room_target ON submissions (room_id, target_participant_id)",
] as const;

let schemaPromise: Promise<void> | undefined;

export async function ensureRoomSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const d1 = getD1();
      await d1.batch(
        schemaStatements.map((statement) => d1.prepare(statement)),
      );
      await d1.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }

  await schemaPromise;
}
