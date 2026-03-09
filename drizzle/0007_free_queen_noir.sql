CREATE TABLE `peer_message_reactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`reactorPeerId` varchar(128) NOT NULL,
	`emoji` varchar(8) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_message_reactions_id` PRIMARY KEY(`id`)
);
