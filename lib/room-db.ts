import { getD1 } from "@/db";

const baseTableStatements = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY NOT NULL,
    share_code_hash TEXT NOT NULL,
    share_code_ciphertext TEXT,
    host_token_hash TEXT NOT NULL,
    owner_account_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'playing', 'finished')),
    reveal_target_names INTEGER NOT NULL DEFAULT 1,
    current_card_index INTEGER NOT NULL DEFAULT -1 CHECK (current_card_index >= -1),
    current_target_revealed INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
] as const;

const relatedTableAndIndexStatements = [
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
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_share_code_hash ON rooms (share_code_hash)",
  "CREATE INDEX IF NOT EXISTS idx_rooms_owner_updated_at ON rooms (owner_account_id, updated_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_room_normalized_name ON participants (room_id, normalized_name)",
  "CREATE INDEX IF NOT EXISTS idx_participants_room_sort_order ON participants (room_id, sort_order)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_room_submission_key ON submissions (room_id, submission_key_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_room_reveal_sort_key ON submissions (room_id, reveal_sort_key)",
  "CREATE INDEX IF NOT EXISTS idx_submissions_room_target ON submissions (room_id, target_participant_id)",
] as const;

async function ensureRoomColumn(
  d1: D1Database,
  columnName: string,
  definition: string,
) {
  const hasColumn = async () => {
    const result = await d1
      .prepare("PRAGMA table_info(rooms)")
      .all<{ name: string }>();
    return result.results.some((column) => column.name === columnName);
  };

  if (await hasColumn()) return;
  try {
    await d1.prepare(`ALTER TABLE rooms ADD COLUMN ${definition}`).run();
  } catch (error) {
    // Multiple fresh isolates can race while upgrading the same old local D1.
    // A re-read distinguishes that harmless race from a real ALTER failure.
    if (!(await hasColumn())) throw error;
  }
}

let schemaPromise: Promise<void> | undefined;

export async function ensureRoomSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const d1 = getD1();
      await d1.batch(
        baseTableStatements.map((statement) => d1.prepare(statement)),
      );
      await ensureRoomColumn(
        d1,
        "owner_account_id",
        "owner_account_id TEXT",
      );
      await ensureRoomColumn(
        d1,
        "share_code_ciphertext",
        "share_code_ciphertext TEXT",
      );
      await d1.batch(
        relatedTableAndIndexStatements.map((statement) =>
          d1.prepare(statement),
        ),
      );
      await d1.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }

  await schemaPromise;
}
