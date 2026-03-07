ALTER TABLE `user_settings` ADD `timelockSolBlocks` int DEFAULT 144 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `timelockEthBlocks` int DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `timelockBtcBlocks` int DEFAULT 6 NOT NULL;