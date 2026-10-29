CREATE TABLE `hosted_embedding_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`vector` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hosted_request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
