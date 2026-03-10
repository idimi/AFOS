ALTER TABLE `user_settings` ADD `ownerNotifyHtlcLocked` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ownerNotifySecretRevealed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ownerNotifyRfqSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ownerNotifyMissedLock` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ownerNotifySwapCompleted` int DEFAULT 1 NOT NULL;