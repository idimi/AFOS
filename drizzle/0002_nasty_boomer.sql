ALTER TABLE `admin_config` ADD `lastOracleSyncAt` timestamp;--> statement-breakpoint
ALTER TABLE `admin_config` ADD `lastSyncInserted` int DEFAULT 0;