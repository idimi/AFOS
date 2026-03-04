CREATE TABLE `user_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`maxTxAmountUsd` int NOT NULL DEFAULT 500,
	`autoConfirm` int NOT NULL DEFAULT 0,
	`slippagePct` varchar(8) NOT NULL DEFAULT '0.5',
	`preferredRoute` enum('intercomswap','jupiter','oneinch','best') NOT NULL DEFAULT 'best',
	`theme` enum('dark','light','system') NOT NULL DEFAULT 'dark',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_settings_openId_unique` UNIQUE(`openId`)
);
