CREATE TABLE `fixture_sync_state` (
	`fixture_id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'txline-devnet' NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`player_count` integer DEFAULT 0 NOT NULL,
	`attributed_event_count` integer DEFAULT 0 NOT NULL,
	`data_coverage` text DEFAULT 'unavailable' NOT NULL,
	`historical_fetched_at` text,
	`reconciled_at` text,
	`finalised` integer DEFAULT false NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `feed_events` ADD `action` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `feed_events` ADD `participant` integer;--> statement-breakpoint
ALTER TABLE `feed_events` ADD `event_epoch` integer;--> statement-breakpoint
ALTER TABLE `fixtures` ADD `competition_id` text;--> statement-breakpoint
ALTER TABLE `fixtures` ADD `competition_name` text;--> statement-breakpoint
ALTER TABLE `fixtures` ADD `participant_1_id` text;--> statement-breakpoint
ALTER TABLE `fixtures` ADD `participant_2_id` text;--> statement-breakpoint
ALTER TABLE `fixtures` ADD `data_coverage` text DEFAULT 'unavailable' NOT NULL;--> statement-breakpoint
ALTER TABLE `fixtures` ADD `formula_version` text;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `assists` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `chances_created` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `tackles` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `performance_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `formula_version` text DEFAULT 'position-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `data_coverage` text DEFAULT 'unavailable' NOT NULL;--> statement-breakpoint
ALTER TABLE `player_match_stats` ADD `source` text DEFAULT 'txline-devnet' NOT NULL;