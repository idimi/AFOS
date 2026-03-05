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
