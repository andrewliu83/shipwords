CREATE TABLE `upstream_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`upstream` text NOT NULL,
	`base_url` text,
	`key_ciphertext` text NOT NULL,
	`key_iv` text NOT NULL,
	`key_hint` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_credentials_default_idx` ON `upstream_credentials` (`upstream`) WHERE "upstream_credentials"."is_default" = 1;--> statement-breakpoint
ALTER TABLE `jobs` ADD `credential_id` text;