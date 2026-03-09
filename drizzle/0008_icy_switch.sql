ALTER TABLE `user_settings` ADD `notifyReactions` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `notifyIncomingDm` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `notifyUnreadBadge` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `notifyTradeInquiry` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `showReadReceipts` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `showTypingIndicator` int DEFAULT 1 NOT NULL;