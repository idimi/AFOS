CREATE TABLE `active_rfqs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqId` varchar(128) NOT NULL,
	`fromPeerId` varchar(128),
	`requesterAlias` varchar(128),
	`fromToken` varchar(16) NOT NULL,
	`toToken` varchar(16) NOT NULL,
	`fromChain` varchar(32) NOT NULL DEFAULT 'solana',
	`toChain` varchar(32) NOT NULL DEFAULT 'solana',
	`amount` double NOT NULL DEFAULT 0,
	`outAmount` double,
	`rate` double,
	`secretHashHex` varchar(64),
	`expiresAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `active_rfqs_id` PRIMARY KEY(`id`),
	CONSTRAINT `active_rfqs_rfqId_unique` UNIQUE(`rfqId`)
);
