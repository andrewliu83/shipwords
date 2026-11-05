CREATE TABLE `model_overrides` (
	`model_id` text PRIMARY KEY NOT NULL,
	`override_json` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `override_json` text;