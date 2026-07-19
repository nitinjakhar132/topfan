CREATE TABLE `player_external_ids` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`player_id` text NOT NULL,
	`first_seen_fixture_id` text,
	`last_seen_fixture_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_ext_ids_unique` ON `player_external_ids` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `player_ext_ids_player_idx` ON `player_external_ids` (`player_id`);--> statement-breakpoint
CREATE TABLE `player_match_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_id` text NOT NULL,
	`player_id` text NOT NULL,
	`team_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_subtype` text,
	`match_minute` integer,
	`outcome` text,
	`confirmed` integer DEFAULT false NOT NULL,
	`source_sequence` integer NOT NULL,
	`rating_delta` real,
	`metadata_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_match_events_fixture_idx` ON `player_match_events` (`fixture_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `player_tournament_stats` (
	`player_id` text NOT NULL,
	`competition_id` text NOT NULL,
	`team_id` text NOT NULL,
	`position` text NOT NULL,
	`matches_named` integer DEFAULT 0 NOT NULL,
	`appearances` integer DEFAULT 0 NOT NULL,
	`starts` integer DEFAULT 0 NOT NULL,
	`substitute_appearances` integer DEFAULT 0 NOT NULL,
	`total_minutes` integer DEFAULT 0 NOT NULL,
	`total_goals` integer,
	`total_assists` integer,
	`total_shots` integer,
	`total_shots_on_target` integer,
	`total_chances_created` integer,
	`total_tackles` integer,
	`total_yellow_cards` integer,
	`total_red_cards` integer,
	`total_own_goals` integer,
	`total_penalty_attempts` integer,
	`total_penalty_goals` integer,
	`total_clean_sheets` integer,
	`total_defensive_actions` integer,
	`goals_per_90` real,
	`assists_per_90` real,
	`shots_per_90` real,
	`shots_on_target_per_90` real,
	`chances_created_per_90` real,
	`tackles_per_90` real,
	`minutes_weighted_rating` real,
	`simple_average_rating` real,
	`best_rating` real,
	`worst_rating` real,
	`recent_form_rating` real,
	`consistency_score` real,
	`form_trend` text DEFAULT 'insufficient_data' NOT NULL,
	`spider_form` real,
	`spider_impact` real,
	`spider_threat` real,
	`spider_big_moments` real,
	`spider_reliability` real,
	`spider_discipline` real,
	`position_rank` integer,
	`team_rank` integer,
	`qualified_for_percentiles` integer DEFAULT false NOT NULL,
	`available_metrics_json` text DEFAULT '[]' NOT NULL,
	`sample_quality` text DEFAULT 'none' NOT NULL,
	`rating_version` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`player_id`, `competition_id`)
);
--> statement-breakpoint
CREATE INDEX `pts_competition_team_pos_idx` ON `player_tournament_stats` (`competition_id`,`team_id`,`position`);--> statement-breakpoint
CREATE TABLE `player_traits` (
	`player_id` text NOT NULL,
	`competition_id` text NOT NULL,
	`trait_key` text NOT NULL,
	`trait_strength` real NOT NULL,
	`evidence_json` text NOT NULL,
	`rating_version` text,
	`generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`player_id`, `competition_id`, `trait_key`)
);
--> statement-breakpoint
CREATE TABLE `rating_model_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`weights_json` text NOT NULL,
	`required_metrics_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `raw_score_events` (
	`fixture_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text,
	`event_timestamp` text,
	`action` text,
	`confirmed` integer,
	`participant_id` text,
	`player_id` text,
	`player_in_id` text,
	`player_out_id` text,
	`match_minute` integer,
	`superseded_by_sequence` integer,
	`raw_payload` text NOT NULL,
	`ingested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`fixture_id`, `sequence`)
);
--> statement-breakpoint
CREATE INDEX `raw_score_events_player_idx` ON `raw_score_events` (`player_id`);--> statement-breakpoint
CREATE TABLE `user_player_history` (
	`wallet` text NOT NULL,
	`player_id` text NOT NULL,
	`competition_id` text NOT NULL,
	`times_selected` integer DEFAULT 0 NOT NULL,
	`completed_selections` integer DEFAULT 0 NOT NULL,
	`total_rating_when_selected` real DEFAULT 0 NOT NULL,
	`average_rating_when_selected` real,
	`position_comparisons_won` integer DEFAULT 0 NOT NULL,
	`supporter_points_generated` real DEFAULT 0 NOT NULL,
	`best_fixture_id` text,
	`last_selected_fixture_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`wallet`, `player_id`, `competition_id`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_player_match_stats` (
	`fixture_id` text NOT NULL,
	`player_id` text NOT NULL,
	`team_id` text,
	`stat_position` text,
	`minutes` integer DEFAULT 0 NOT NULL,
	`goals` integer DEFAULT 0 NOT NULL,
	`assists` integer DEFAULT 0 NOT NULL,
	`chances_created` integer DEFAULT 0 NOT NULL,
	`tackles` integer DEFAULT 0 NOT NULL,
	`own_goals` integer DEFAULT 0 NOT NULL,
	`shots` integer DEFAULT 0 NOT NULL,
	`shots_on_target` integer DEFAULT 0 NOT NULL,
	`yellow_cards` integer DEFAULT 0 NOT NULL,
	`red_cards` integer DEFAULT 0 NOT NULL,
	`penalty_attempts` integer DEFAULT 0 NOT NULL,
	`penalty_goals` integer DEFAULT 0 NOT NULL,
	`performance_score` real DEFAULT 0 NOT NULL,
	`impact_rating` real,
	`formula_version` text DEFAULT 'position-v1' NOT NULL,
	`data_coverage` text DEFAULT 'unavailable' NOT NULL,
	`source` text DEFAULT 'txline-devnet' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`stat_starter` integer,
	`stat_official_substitute` integer,
	`entered_match` integer,
	`minute_on` integer,
	`minute_off` integer,
	`minutes_played` integer,
	`clean_sheet` integer,
	`defensive_actions` integer,
	`shots_off_target` integer,
	`shots_blocked` integer,
	`shots_woodwork` integer,
	`live_rating` real,
	`final_rating` real,
	`rating_version` text,
	`available_metrics_json` text,
	`stat_finalised` integer,
	`recalculated_at` text,
	PRIMARY KEY(`fixture_id`, `player_id`)
);
--> statement-breakpoint
INSERT INTO `__new_player_match_stats`("fixture_id", "player_id", "team_id", "stat_position", "minutes", "goals", "assists", "chances_created", "tackles", "own_goals", "shots", "shots_on_target", "yellow_cards", "red_cards", "penalty_attempts", "penalty_goals", "performance_score", "impact_rating", "formula_version", "data_coverage", "source", "updated_at", "stat_starter", "stat_official_substitute", "entered_match", "minute_on", "minute_off", "minutes_played", "clean_sheet", "defensive_actions", "shots_off_target", "shots_blocked", "shots_woodwork", "live_rating", "final_rating", "rating_version", "available_metrics_json", "stat_finalised", "recalculated_at") SELECT "fixture_id", "player_id", "team_id", "stat_position", "minutes", "goals", "assists", "chances_created", "tackles", "own_goals", "shots", "shots_on_target", "yellow_cards", "red_cards", "penalty_attempts", "penalty_goals", "performance_score", "impact_rating", "formula_version", "data_coverage", "source", "updated_at", "stat_starter", "stat_official_substitute", "entered_match", "minute_on", "minute_off", "minutes_played", "clean_sheet", "defensive_actions", "shots_off_target", "shots_blocked", "shots_woodwork", "live_rating", "final_rating", "rating_version", "available_metrics_json", "stat_finalised", "recalculated_at" FROM `player_match_stats`;--> statement-breakpoint
DROP TABLE `player_match_stats`;--> statement-breakpoint
ALTER TABLE `__new_player_match_stats` RENAME TO `player_match_stats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `player_match_stats_player_idx` ON `player_match_stats` (`player_id`);--> statement-breakpoint
ALTER TABLE `lineups` ADD `fixture_player_id` text;--> statement-breakpoint
ALTER TABLE `lineups` ADD `shirt_number` integer;--> statement-breakpoint
ALTER TABLE `lineups` ADD `source_position` text;--> statement-breakpoint
ALTER TABLE `lineups` ADD `normalized_position` text;--> statement-breakpoint
ALTER TABLE `lineups` ADD `announced_at` text;--> statement-breakpoint
ALTER TABLE `lineups` ADD `raw_payload` text;--> statement-breakpoint
ALTER TABLE `players` ADD `normative_id` text;--> statement-breakpoint
ALTER TABLE `players` ADD `preferred_name` text;--> statement-breakpoint
ALTER TABLE `players` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `players` ADD `primary_position` text;--> statement-breakpoint
ALTER TABLE `players` ADD `sofascore_id` integer;--> statement-breakpoint
ALTER TABLE `players` ADD `date_of_birth` text;--> statement-breakpoint
ALTER TABLE `players` ADD `country_id` text;--> statement-breakpoint
ALTER TABLE `players` ADD `photo_url` text;--> statement-breakpoint
ALTER TABLE `players` ADD `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;