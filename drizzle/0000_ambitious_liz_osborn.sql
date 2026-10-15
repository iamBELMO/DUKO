CREATE TABLE `duko_rates` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `duko_rates_expiry` ON `duko_rates` (`expires_at`);--> statement-breakpoint
CREATE TABLE `duko_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `duko_rooms_updated` ON `duko_rooms` (`updated_at`);--> statement-breakpoint
CREATE TABLE `duko_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`room_code` text,
	`client_id` text,
	`expires_at` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duko_sessions_player_id_unique` ON `duko_sessions` (`player_id`);--> statement-breakpoint
CREATE INDEX `duko_sessions_room` ON `duko_sessions` (`room_code`);--> statement-breakpoint
CREATE INDEX `duko_sessions_expiry` ON `duko_sessions` (`expires_at`);