CREATE TABLE `feed_events` (
	`fixture_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`fixture_id`, `sequence`)
);
--> statement-breakpoint
CREATE TABLE `fixtures` (
	`id` text PRIMARY KEY NOT NULL,
	`home_team_id` text NOT NULL,
	`away_team_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`phase` text DEFAULT 'scheduled' NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`finalised_at` text,
	`raw_updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fixtures_starts_at_idx` ON `fixtures` (`starts_at`);--> statement-breakpoint
CREATE TABLE `lineups` (
	`fixture_id` text NOT NULL,
	`player_id` text NOT NULL,
	`team_id` text NOT NULL,
	`starter` integer NOT NULL,
	`official_substitute` integer NOT NULL,
	`position` text NOT NULL,
	PRIMARY KEY(`fixture_id`, `player_id`)
);
--> statement-breakpoint
CREATE TABLE `match_scores` (
	`fixture_id` text NOT NULL,
	`wallet` text NOT NULL,
	`team_id` text NOT NULL,
	`selected_trio` real NOT NULL,
	`best_own_trio` real NOT NULL,
	`best_opposition_trio` real NOT NULL,
	`selection_accuracy` real NOT NULL,
	`matchup_index` real NOT NULL,
	`rank` integer NOT NULL,
	`entrants` integer NOT NULL,
	`percentile` real NOT NULL,
	`base_score` real NOT NULL,
	`placement_bonus` real NOT NULL,
	`contribution` real NOT NULL,
	`finalised_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`fixture_id`, `wallet`)
);
--> statement-breakpoint
CREATE INDEX `match_scores_team_idx` ON `match_scores` (`team_id`,`contribution`);--> statement-breakpoint
CREATE TABLE `picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_id` text NOT NULL,
	`wallet` text NOT NULL,
	`team_id` text NOT NULL,
	`attacker_id` text NOT NULL,
	`midfielder_id` text NOT NULL,
	`defender_id` text NOT NULL,
	`locked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`commitment_signature` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `picks_fixture_wallet_unique` ON `picks` (`fixture_id`,`wallet`);--> statement-breakpoint
CREATE TABLE `player_match_stats` (
	`fixture_id` text NOT NULL,
	`player_id` text NOT NULL,
	`minutes` integer DEFAULT 0 NOT NULL,
	`goals` integer DEFAULT 0 NOT NULL,
	`own_goals` integer DEFAULT 0 NOT NULL,
	`shots` integer DEFAULT 0 NOT NULL,
	`shots_on_target` integer DEFAULT 0 NOT NULL,
	`yellow_cards` integer DEFAULT 0 NOT NULL,
	`red_cards` integer DEFAULT 0 NOT NULL,
	`penalty_attempts` integer DEFAULT 0 NOT NULL,
	`penalty_goals` integer DEFAULT 0 NOT NULL,
	`impact_rating` real DEFAULT 6 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`fixture_id`, `player_id`)
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`shirt_number` integer
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`flag` text DEFAULT '' NOT NULL,
	`eliminated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_code_unique` ON `teams` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`wallet` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'Supporter' NOT NULL,
	`primary_team_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
