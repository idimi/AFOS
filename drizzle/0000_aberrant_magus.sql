CREATE TABLE `admin_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userName` varchar(128),
	`section` varchar(64) NOT NULL,
	`fieldName` varchar(128) NOT NULL,
	`oldValue` text,
	`newValue` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feeEnabled` int NOT NULL DEFAULT 1,
	`swapFeeBps` int NOT NULL DEFAULT 20,
	`expressFeeBps` int NOT NULL DEFAULT 5,
	`botFeeCents` int NOT NULL DEFAULT 10,
	`minTradeUsdCents` int NOT NULL DEFAULT 1000,
	`maxTradeUsdCents` int NOT NULL DEFAULT 100000,
	`treasuryWallets` text,
	`feeAlertThresholdCents` int NOT NULL DEFAULT 100,
	`feeAlertLastNotifiedDate` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `operator_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`llmModel` varchar(100) NOT NULL DEFAULT 'kimi-k2-turbo',
	`systemPrompt` text,
	`rendezvousChannel` varchar(200) NOT NULL DEFAULT '0000intercomswapbtcusdt',
	`peerMode` varchar(20) NOT NULL DEFAULT 'maker-taker',
	`minSwapUsdt` varchar(20) NOT NULL DEFAULT '10',
	`maxSwapUsdt` varchar(20) NOT NULL DEFAULT '1000',
	`scBridgePort` varchar(10) NOT NULL DEFAULT '49222',
	`btcHost` varchar(200) NOT NULL DEFAULT 'localhost:8332',
	`btcRpcPassword` varchar(500) NOT NULL DEFAULT '',
	`btcTlsCert` varchar(500) NOT NULL DEFAULT '/root/.lnd/tls.cert',
	`solanaRpc` varchar(500) NOT NULL DEFAULT 'https://api.mainnet-beta.solana.com',
	`solanaKeypairPath` varchar(500) NOT NULL DEFAULT 'onchain/solana/keypair.json',
	`tradeauto` int NOT NULL DEFAULT 0,
	`maxTradeBtc` varchar(30) NOT NULL DEFAULT '0.01',
	`feeBpsCap` varchar(10) NOT NULL DEFAULT '50',
	`tickInterval` varchar(10) NOT NULL DEFAULT '3800',
	`minRefundHours` varchar(10) NOT NULL DEFAULT '20',
	`maxRefundHours` varchar(10) NOT NULL DEFAULT '40',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operator_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `peer_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`blockerPeerId` varchar(128) NOT NULL,
	`blockedPeerId` varchar(128) NOT NULL,
	`reason` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_blocks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `peer_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPeerId` varchar(128) NOT NULL,
	`toPeerId` varchar(128) NOT NULL,
	`body` varchar(500) NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `peer_mutes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`muterPeerId` varchar(128) NOT NULL,
	`mutedPeerId` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_mutes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `peer_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reporterPeerId` varchar(128) NOT NULL,
	`reportedPeerId` varchar(128) NOT NULL,
	`reason` varchar(64) NOT NULL,
	`details` text,
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `peer_reputation` (
	`id` int AUTO_INCREMENT NOT NULL,
	`peerId` varchar(128) NOT NULL,
	`alias` varchar(64),
	`origin` varchar(32) NOT NULL DEFAULT 'hyperswarm',
	`successfulSwaps` int NOT NULL DEFAULT 0,
	`failedPings` int NOT NULL DEFAULT 0,
	`successfulPings` int NOT NULL DEFAULT 0,
	`totalLatencyMs` int NOT NULL DEFAULT 0,
	`score` int NOT NULL DEFAULT 50,
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`notes` text,
	`tags` text,
	CONSTRAINT `peer_reputation_id` PRIMARY KEY(`id`),
	CONSTRAINT `peer_reputation_peerId_unique` UNIQUE(`peerId`)
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
	`platformFeeUsd` varchar(32),
	`feeBps` int,
	`feeAmountOut` varchar(32),
	`outAmount` varchar(32),
	`walletAddress` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `swap_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`maxTxAmountUsd` int NOT NULL DEFAULT 500,
	`autoConfirm` int NOT NULL DEFAULT 0,
	`slippagePct` varchar(8) NOT NULL DEFAULT '0.5',
	`preferredRoute` enum('intercomswap','jupiter','zerox','oneinch','best') NOT NULL DEFAULT 'best',
	`theme` enum('dark','light','system') NOT NULL DEFAULT 'dark',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_settings_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
