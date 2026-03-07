ALTER TABLE `htlc_swaps` MODIFY COLUMN `chain` enum('bitcoin','ethereum','solana','trac_network') NOT NULL;--> statement-breakpoint
ALTER TABLE `htlc_swaps` MODIFY COLUMN `toChain` enum('bitcoin','ethereum','solana','trac_network');--> statement-breakpoint
ALTER TABLE `swap_analytics` MODIFY COLUMN `fromChain` enum('bitcoin','ethereum','solana','trac_network') NOT NULL;--> statement-breakpoint
ALTER TABLE `swap_analytics` MODIFY COLUMN `toChain` enum('bitcoin','ethereum','solana','trac_network') NOT NULL;