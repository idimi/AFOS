ALTER TABLE `htlc_secrets` ADD `counterpartyLockTxId` varchar(128);--> statement-breakpoint
ALTER TABLE `htlc_secrets` ADD `escrowAddress` varchar(256);