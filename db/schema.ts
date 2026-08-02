import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_accounts_email").on(table.email)],
);

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    shareCodeHash: text("share_code_hash").notNull(),
    shareCodeCiphertext: text("share_code_ciphertext"),
    hostTokenHash: text("host_token_hash").notNull(),
    ownerAccountId: text("owner_account_id"),
    title: text("title").notNull().default(""),
    status: text("status").notNull().default("collecting"),
    revealTargetNames: integer("reveal_target_names", { mode: "boolean" })
      .notNull()
      .default(true),
    currentCardIndex: integer("current_card_index").notNull().default(-1),
    currentTargetRevealed: integer("current_target_revealed", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_rooms_share_code_hash").on(table.shareCodeHash),
    index("idx_rooms_owner_updated_at").on(
      table.ownerAccountId,
      table.updatedAt,
    ),
    check(
      "rooms_status_check",
      sql`${table.status} IN ('collecting', 'playing', 'finished')`,
    ),
    check(
      "rooms_current_card_index_check",
      sql`${table.currentCardIndex} >= -1`,
    ),
  ],
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("idx_participants_room_normalized_name").on(
      table.roomId,
      table.normalizedName,
    ),
    index("idx_participants_room_sort_order").on(
      table.roomId,
      table.sortOrder,
    ),
  ],
);

export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    targetParticipantId: text("target_participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    submissionKeyHash: text("submission_key_hash").notNull(),
    revealSortKey: text("reveal_sort_key").notNull(),
  },
  (table) => [
    uniqueIndex("idx_submissions_room_submission_key").on(
      table.roomId,
      table.submissionKeyHash,
    ),
    uniqueIndex("idx_submissions_room_reveal_sort_key").on(
      table.roomId,
      table.revealSortKey,
    ),
    index("idx_submissions_room_target").on(
      table.roomId,
      table.targetParticipantId,
    ),
  ],
);
