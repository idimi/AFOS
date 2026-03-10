/**
 * htlcCleanup.ts
 * Deletes htlc_secrets rows that are older than 7 days and have a terminal
 * status (expired or refunded). This prevents the HTLC secrets monitor from
 * reprocessing stale rows and keeps the table lean.
 *
 * The cleanup runs once on startup (after a short warm-up) and then every
 * 24 hours. It is intentionally conservative — only rows with a clearly
 * terminal status are removed.
 */

import { getDb } from "../db.js";
import { htlcSecrets } from "../../drizzle/schema.js";
import { and, inArray, lt } from "drizzle-orm";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
export async function runHtlcCleanup(): Promise<{ deleted: number; error?: string }> {
  const db = await getDb();
  if (!db) return { deleted: 0, error: "Database not available" };

  try {
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
    // Delete expired rows
    const expiredResult = await db
      .delete(htlcSecrets)
      .where(
        and(
          inArray(htlcSecrets.status, ["expired", "refunded"]),
          lt(htlcSecrets.createdAt, cutoff),
        ),
      );
    const deleted = (expiredResult as { affectedRows?: number }).affectedRows ?? 0;
    return { deleted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[HtlcCleanup] Error during cleanup:", msg);
    return { deleted: 0, error: msg };
  }
}
