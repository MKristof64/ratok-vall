CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_participants_room_normalized_name` ON `participants` (`room_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_participants_room_sort_order` ON `participants` (`room_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`share_code_hash` text NOT NULL,
	`host_token_hash` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'collecting' NOT NULL,
	`reveal_target_names` integer DEFAULT true NOT NULL,
	`current_card_index` integer DEFAULT -1 NOT NULL,
	`current_target_revealed` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "rooms_status_check" CHECK("rooms"."status" IN ('collecting', 'playing', 'finished')),
	CONSTRAINT "rooms_current_card_index_check" CHECK("rooms"."current_card_index" >= -1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_share_code_hash` ON `rooms` (`share_code_hash`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`target_participant_id` text NOT NULL,
	`body` text NOT NULL,
	`submission_key_hash` text NOT NULL,
	`reveal_sort_key` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_submissions_room_submission_key` ON `submissions` (`room_id`,`submission_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_submissions_room_reveal_sort_key` ON `submissions` (`room_id`,`reveal_sort_key`);--> statement-breakpoint
CREATE INDEX `idx_submissions_room_target` ON `submissions` (`room_id`,`target_participant_id`);