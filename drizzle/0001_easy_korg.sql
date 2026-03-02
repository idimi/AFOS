CREATE TABLE `htlc_swaps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chain` enum('bitcoin','ethereum','solana') NOT NULL,
	`htlcAddress` varchar(128) NOT NULL,
	`secretHash` varchar(64) NOT NULL,
	`lockTxId` varchar(128),
	`amountRaw` varchar(32) NOT NULL,
	`amountHuman` varchar(32) NOT NULL,
	`locktime` int NOT NULL,
	`status` enum('pending','completed','refunded','expired') NOT NULL DEFAULT 'pending',
	`peerId` varchar(128),
	`rfqId` varchar(128),
	`toToken` varchar(16),
	`toChain` enum('bitcoin','ethereum','solana'),
	`refundTxId` varchar(128),
	`senderAddress` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`refundedAt` timestamp,
	CONSTRAINT `htlc_swaps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `swap_analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromChain` enum('bitcoin','ethereum','solana') NOT NULL,
	`toChain` enum('bitcoin','ethereum','solana') NOT NULL,
	`fromToken` varchar(16) NOT NULL,
	`toToken` varchar(16) NOT NULL,
	`amount` varchar(32) NOT NULL,
	`amountUsd` varchar(32),
	`route` varchar(64) NOT NULL,
	`status` enum('completed','failed','refunded') NOT NULL,
	`settlementMs` int,
	`txId` varchar(128),
	`peerId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `swap_analytics_id` PRIMARY KEY(`id`)
);
