CREATE TABLE `htlc_secrets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqId` varchar(128) NOT NULL,
	`secretHex` varchar(64) NOT NULL,
	`secretHashHex` varchar(64) NOT NULL,
	`fromChain` enum('bitcoin','ethereum','solana','trac_network') NOT NULL,
	`toChain` enum('bitcoin','ethereum','solana','trac_network') NOT NULL,
	`requesterAddress` varchar(128),
	`counterpartyPeerId` varchar(128),
	`expiresAt` bigint NOT NULL,
	`status` enum('locked','revealed','completed','expired','refunded') NOT NULL DEFAULT 'locked',
	`lockTxId` varchar(128),
	`revealTxId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `htlc_secrets_id` PRIMARY KEY(`id`),
	CONSTRAINT `htlc_secrets_rfqId_unique` UNIQUE(`rfqId`)
);
