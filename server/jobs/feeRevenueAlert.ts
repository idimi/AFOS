/**
 * Fee Revenue Alert Job
 *
 * Checks today's total fee revenue against the configured threshold.
 * If revenue exceeds the threshold and we haven't already sent an alert today,
 * fires a notifyOwner notification and marks today as notified.
 *
 * Called from:
 *   - The analytics.checkFeeAlert tRPC mutation (triggered by the Revenue tab)
 *   - Optionally from a server-side interval (see server/_core/index.ts)
 *
 * Idempotent: only one notification per calendar day (UTC).
 */

import { getDb } from "../db";
import { adminConfig, swapAnalytics } from "../../drizzle/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function sinceStartOfDayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function runFeeRevenueAlert(): Promise<{
  checked: boolean;
  alerted: boolean;
  totalFeeUsd: number;
  thresholdUsd: number;
  reason?: string;
}> {
  const db = await getDb();
  if (!db) return { checked: false, alerted: false, totalFeeUsd: 0, thresholdUsd: 0, reason: "no-db" };

  // 1. Load admin config
  const [cfg] = await db.select().from(adminConfig).where(eq(adminConfig.id, 1)).limit(1);
  if (!cfg) return { checked: false, alerted: false, totalFeeUsd: 0, thresholdUsd: 0, reason: "no-config" };

  const thresholdUsd = cfg.feeAlertThresholdCents / 100;

  // 0 threshold = alerts disabled
  if (cfg.feeAlertThresholdCents <= 0) {
    return { checked: true, alerted: false, totalFeeUsd: 0, thresholdUsd, reason: "disabled" };
  }

  // 2. Check if we already sent an alert today
  const today = todayUtc();
  if (cfg.feeAlertLastNotifiedDate === today) {
    return { checked: true, alerted: false, totalFeeUsd: 0, thresholdUsd, reason: "already-notified-today" };
  }

  // 3. Query today's total fee revenue
  const since = sinceStartOfDayUtc();
  const [row] = await db
    .select({
      totalFeeUsd: sql<string>`COALESCE(SUM(CAST(${swapAnalytics.platformFeeUsd} AS DECIMAL(20,8))), 0)`,
      swapCount:   sql<string>`COUNT(*)`,
    })
    .from(swapAnalytics)
    .where(
      and(
        eq(swapAnalytics.status, "completed"),
        gte(swapAnalytics.createdAt, since)
      )
    );

  const totalFeeUsd = parseFloat(row?.totalFeeUsd ?? "0");
  const swapCount   = Number(row?.swapCount ?? 0);

  // 4. Check threshold
  if (totalFeeUsd < thresholdUsd) {
    return { checked: true, alerted: false, totalFeeUsd, thresholdUsd, reason: "below-threshold" };
  }

  // 5. Fire notification
  const sent = await notifyOwner({
    title: `💰 AFOS Fee Revenue Alert — $${totalFeeUsd.toFixed(2)} earned today`,
    content: [
      `Your AFOS platform has crossed the $${thresholdUsd.toFixed(2)} daily fee revenue threshold.`,
      ``,
      `📊 Today's Summary (UTC):`,
      `  • Total fee revenue: $${totalFeeUsd.toFixed(4)}`,
      `  • Swaps completed:   ${swapCount}`,
      `  • Threshold:         $${thresholdUsd.toFixed(2)}`,
      ``,
      `Log in to the Admin Panel → Revenue tab for a full breakdown.`,
    ].join("\n"),
  }).catch(() => false);

  // 6. Mark today as notified (even if the push failed, to avoid spam)
  await db.update(adminConfig)
    .set({ feeAlertLastNotifiedDate: today })
    .where(eq(adminConfig.id, 1));

  return { checked: true, alerted: sent, totalFeeUsd, thresholdUsd };
}
