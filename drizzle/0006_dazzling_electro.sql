CREATE TABLE `peer_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromPeerId` varchar(128) NOT NULL,
	`toPeerId` varchar(128) NOT NULL,
	`body` varchar(500) NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `peer_messages_id` PRIMARY KEY(`id`)
);
