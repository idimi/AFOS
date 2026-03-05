ALTER TABLE `admin_config` ADD `feeAlertThresholdCents` int DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_config` ADD `feeAlertLastNotifiedDate` varchar(10);