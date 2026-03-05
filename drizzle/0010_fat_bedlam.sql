CREATE TABLE `admin_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feeEnabled` int NOT NULL DEFAULT 1,
	`swapFeeBps` int NOT NULL DEFAULT 20,
	`expressFeeBps` int NOT NULL DEFAULT 5,
	`botFeeCents` int NOT NULL DEFAULT 10,
	`minTradeUsdCents` int NOT NULL DEFAULT 1000,
	`maxTradeUsdCents` int NOT NULL DEFAULT 100000,
	`treasuryWallets` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_config_id` PRIMARY KEY(`id`)
);
