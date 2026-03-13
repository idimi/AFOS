/**
 * webhookHealth router
 *
 * Exposes the Helius HTLC webhook status via a tRPC procedure so the
 * Admin panel can display a live health widget without making direct
 * HTTP requests to the internal status endpoint.
 *
 * Procedure: webhookHealth.getStatus (admin-only)
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getWebhookStatus } from "../webhooks/heliusHtlc.js";
import { getDb } from "../db.js";
import { htlcSecrets } from "../../drizzle/schema.js";
import { sql } from "drizzle-orm";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

export const webhookHealthRouter = router({
  /**
   * Returns the current Helius webhook status plus settlement breakdown stats.
   * Auto-refreshed every 30s in the Admin panel.
   */
  getStatus: adminProcedure.query(async () => {
    const status = getWebhookStatus();

    // Fetch settlement breakdown from DB
    const db = await getDb();
    let settlementBreakdown: { settledVia: string | null; count: number }[] = [];
    let avgSettlementMs: number | null = null;
    let webhookClaimCount = 0;
    let fastClaimCount = 0; // < 30s

    if (db) {
      try {
        // Count by settledVia
        const rows = await db
          .select({
            settledVia: htlcSecrets.settledVia,
            count: sql<number>`COUNT(*)`,
          })
          .from(htlcSecrets)
          .where(sql`${htlcSecrets.status} = 'completed' AND ${htlcSecrets.settledVia} IS NOT NULL`)
          .groupBy(htlcSecrets.settledVia);

        settlementBreakdown = rows.map((r) => ({
          settledVia: r.settledVia,
          count: Number(r.count),
        }));

        webhookClaimCount =
          settlementBreakdown.find((r) => r.settledVia === "helius_webhook")?.count ?? 0;

        // Average settlement time for webhook-triggered claims
        const avgRows = await db
          .select({
            avgMs: sql<number>`AVG(TIMESTAMPDIFF(MILLISECOND, ${htlcSecrets.createdAt}, ${htlcSecrets.settledAt}))`,
            fastCount: sql<number>`SUM(CASE WHEN TIMESTAMPDIFF(MILLISECOND, ${htlcSecrets.createdAt}, ${htlcSecrets.settledAt}) < 30000 THEN 1 ELSE 0 END)`,
          })
          .from(htlcSecrets)
          .where(
            sql`${htlcSecrets.status} = 'completed'
              AND ${htlcSecrets.settledVia} = 'helius_webhook'
              AND ${htlcSecrets.settledAt} IS NOT NULL`
          );

        if (avgRows[0]) {
          avgSettlementMs = avgRows[0].avgMs ? Number(avgRows[0].avgMs) : null;
          fastClaimCount = avgRows[0].fastCount ? Number(avgRows[0].fastCount) : 0;
        }
      } catch (err) {
        // Non-fatal — return status without DB stats
        console.warn("[webhookHealth] DB query failed:", err);
      }
    }

    return {
      // Webhook registration
      webhookId: status.webhookId,
      registeredUrl: status.registeredUrl,
      programAddress: "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW",
      secretConfigured: !!process.env.HELIUS_WEBHOOK_SECRET,

      // Live event counters (in-memory, reset on server restart)
      totalEventsReceived: status.totalEventsReceived,
      totalClaimsTriggered: status.totalClaimsTriggered,
      lastEventAt: status.lastEventAt,
      lastEventSig: status.lastEventSig,
      lastClaimTriggeredAt: status.lastClaimTriggeredAt,

      // DB-backed settlement stats
      settlementBreakdown,
      webhookClaimCount,
      fastClaimCount,
      avgSettlementMs,
    };
  }),
});
