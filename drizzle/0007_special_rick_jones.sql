CREATE TABLE `peer_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`blockerPeerId` varchar(128) NOT NULL,
	`blockedPeerId` varchar(128) NOT NULL,
	`reason` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_blocks_id` PRIMARY KEY(`id`)
);
