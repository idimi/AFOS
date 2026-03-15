ALTER TABLE `htlc_swaps` ADD `claimTxId` varchar(128);--> statement-breakpoint
ALTER TABLE `htlc_swaps` ADD `claimedAt` timestamp;