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
	CONSTRAINT `peer_reputation_id` PRIMARY KEY(`id`),
	CONSTRAINT `peer_reputation_peerId_unique` UNIQUE(`peerId`)
);
