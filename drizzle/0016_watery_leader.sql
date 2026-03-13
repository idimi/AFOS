ALTER TABLE `htlc_secrets` ADD `settledAt` timestamp;--> statement-breakpoint
ALTER TABLE `htlc_secrets` ADD `settledVia` varchar(32);