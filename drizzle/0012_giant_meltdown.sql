ALTER TABLE `htlc_secrets` ADD `htlcId` varchar(128);--> statement-breakpoint
ALTER TABLE `htlc_secrets` ADD `initiatorAddress` varchar(128);--> statement-breakpoint
ALTER TABLE `htlc_secrets` ADD `counterpartyAddress` varchar(128);--> statement-breakpoint
ALTER TABLE `htlc_secrets` ADD `fromToken` varchar(16);--> statement-breakpoint
ALTER TABLE `htlc_secrets` ADD `toToken` varchar(16);