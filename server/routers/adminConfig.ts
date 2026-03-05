/**
 * adminConfig router
 *
 * Provides get/save procedures for the operator-level platform configuration
 * stored in the admin_config singleton table (id = 1).
 *
 * Covers:
 *   - Fee configuration (swap fee bps, express fee, bot fee, min/max trade size, kill switch)
 *   - Treasury wallet list (JSON-encoded array persisted in the DB)
 *   - Audit log read access
 *
 * All procedures require admin role — no public access to admin config.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { adminConfig, adminAuditLog, DEFAULT_ADMIN_CONFIG } from "../../drizzle/schema";
import { eq, desc, and, like } from "drizzle-orm";
import { writeAuditLog, diffObjects } from "../lib/auditLog";

// ─── Admin guard middleware ───────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Treasury wallet schema ───────────────────────────────────────────────────
const treasuryWalletSchema = z.object({
  id:           z.string(),
  label:        z.string(),
  chain:        z.enum(["solana", "ethereum", "bitcoin"]),
  address:      z.string(),
  splitPercent: z.number().min(0).max(100),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getOrCreateConfig() {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select().from(adminConfig).where(eq(adminConfig.id, 1)).limit(1);
  if (row) return row;

  // Bootstrap singleton row with defaults
  await db.insert(adminConfig).values({
    id: 1,
    feeEnabled:       DEFAULT_ADMIN_CONFIG.feeEnabled ? 1 : 0,
    swapFeeBps:       DEFAULT_ADMIN_CONFIG.swapFeeBps,
    expressFeeBps:    DEFAULT_ADMIN_CONFIG.expressFeeBps,
    botFeeCents:      DEFAULT_ADMIN_CONFIG.botFeeCents,
    minTradeUsdCents: DEFAULT_ADMIN_CONFIG.minTradeUsdCents,
    maxTradeUsdCents: DEFAULT_ADMIN_CONFIG.maxTradeUsdCents,
    treasuryWallets:  JSON.stringify(DEFAULT_ADMIN_CONFIG.treasuryWallets),
  });

  const [created] = await db.select().from(adminConfig).where(eq(adminConfig.id, 1)).limit(1);
  return created ?? null;
}

/** Normalise a DB row into a plain object suitable for diffing */
function rowToFeeSnapshot(row: NonNullable<Awaited<ReturnType<typeof getOrCreateConfig>>>) {
  return {
    feeEnabled:             row.feeEnabled === 1,
    swapFeeBps:             row.swapFeeBps,
    expressFeeBps:          row.expressFeeBps,
    botFeeCents:            row.botFeeCents,
    minTradeUsdCents:       row.minTradeUsdCents,
    maxTradeUsdCents:       row.maxTradeUsdCents,
    feeAlertThresholdCents: row.feeAlertThresholdCents,
  } as Record<string, unknown>;
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const adminConfigRouter = router({
  /**
   * Load the current admin config — admin only.
   * Returns defaults when no row exists yet (auto-creates the singleton row).
   */
  get: adminProcedure.query(async () => {
    const row = await getOrCreateConfig();
    if (!row) return {
      feeEnabled:       DEFAULT_ADMIN_CONFIG.feeEnabled,
      swapFeeBps:       DEFAULT_ADMIN_CONFIG.swapFeeBps,
      expressFeeBps:    DEFAULT_ADMIN_CONFIG.expressFeeBps,
      botFeeCents:      DEFAULT_ADMIN_CONFIG.botFeeCents,
      minTradeUsdCents: DEFAULT_ADMIN_CONFIG.minTradeUsdCents,
      maxTradeUsdCents: DEFAULT_ADMIN_CONFIG.maxTradeUsdCents,
      feeAlertThresholdCents: 100,
      feeAlertLastNotifiedDate: null as string | null,
      treasuryWallets:  DEFAULT_ADMIN_CONFIG.treasuryWallets,
    };

    return {
      feeEnabled:             row.feeEnabled === 1,
      swapFeeBps:             row.swapFeeBps,
      expressFeeBps:          row.expressFeeBps,
      botFeeCents:            row.botFeeCents,
      minTradeUsdCents:       row.minTradeUsdCents,
      maxTradeUsdCents:       row.maxTradeUsdCents,
      feeAlertThresholdCents: row.feeAlertThresholdCents,
      feeAlertLastNotifiedDate: row.feeAlertLastNotifiedDate ?? null,
      treasuryWallets:        (() => {
        try { return JSON.parse(row.treasuryWallets ?? "[]") as typeof DEFAULT_ADMIN_CONFIG.treasuryWallets; }
        catch { return DEFAULT_ADMIN_CONFIG.treasuryWallets; }
      })(),
    };
  }),

  /**
   * Save fee configuration fields — admin only.
   * Accepts a partial patch — only provided fields are written.
   * Writes one audit log row per changed field.
   */
  saveFeeConfig: adminProcedure
    .input(z.object({
      feeEnabled:             z.boolean().optional(),
      swapFeeBps:             z.number().int().min(0).max(200).optional(),
      expressFeeBps:          z.number().int().min(0).max(100).optional(),
      botFeeCents:            z.number().int().min(0).max(10000).optional(),
      minTradeUsdCents:       z.number().int().min(10).max(100_000).optional(),
      maxTradeUsdCents:       z.number().int().min(100).max(100_000_000).optional(),
      feeAlertThresholdCents: z.number().int().min(0).max(100_000_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      // Snapshot before state
      const before = await getOrCreateConfig();
      if (!before) return { success: false };
      const beforeSnap = rowToFeeSnapshot(before);

      const patch: Record<string, unknown> = {};
      if (input.feeEnabled             !== undefined) patch.feeEnabled             = input.feeEnabled ? 1 : 0;
      if (input.swapFeeBps             !== undefined) patch.swapFeeBps             = input.swapFeeBps;
      if (input.expressFeeBps          !== undefined) patch.expressFeeBps          = input.expressFeeBps;
      if (input.botFeeCents            !== undefined) patch.botFeeCents            = input.botFeeCents;
      if (input.minTradeUsdCents       !== undefined) patch.minTradeUsdCents       = input.minTradeUsdCents;
      if (input.maxTradeUsdCents       !== undefined) patch.maxTradeUsdCents       = input.maxTradeUsdCents;
      if (input.feeAlertThresholdCents !== undefined) patch.feeAlertThresholdCents = input.feeAlertThresholdCents;

      if (Object.keys(patch).length > 0) {
        await db.update(adminConfig).set(patch).where(eq(adminConfig.id, 1));
      }

      // Build after snapshot from input (normalise feeEnabled to boolean for diff)
      const afterSnap: Record<string, unknown> = { ...beforeSnap };
      if (input.feeEnabled             !== undefined) afterSnap.feeEnabled             = input.feeEnabled;
      if (input.swapFeeBps             !== undefined) afterSnap.swapFeeBps             = input.swapFeeBps;
      if (input.expressFeeBps          !== undefined) afterSnap.expressFeeBps          = input.expressFeeBps;
      if (input.botFeeCents            !== undefined) afterSnap.botFeeCents            = input.botFeeCents;
      if (input.minTradeUsdCents       !== undefined) afterSnap.minTradeUsdCents       = input.minTradeUsdCents;
      if (input.maxTradeUsdCents       !== undefined) afterSnap.maxTradeUsdCents       = input.maxTradeUsdCents;
      if (input.feeAlertThresholdCents !== undefined) afterSnap.feeAlertThresholdCents = input.feeAlertThresholdCents;

      await writeAuditLog({
        userId:   ctx.user.id,
        userName: ctx.user.name ?? ctx.user.email ?? "admin",
        section:  "fee_config",
        changes:  diffObjects(beforeSnap, afterSnap),
      });

      return { success: true };
    }),

  /**
   * Save treasury wallet list — admin only.
   * Replaces the entire list (client sends the full array after add/remove/edit).
   * Writes a single audit log row with the full before/after JSON.
   */
  saveTreasury: adminProcedure
    .input(z.object({
      wallets: z.array(treasuryWalletSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      // Snapshot before state
      const before = await getOrCreateConfig();
      const oldWallets = (() => {
        try { return JSON.parse(before?.treasuryWallets ?? "[]"); }
        catch { return []; }
      })();

      await db.update(adminConfig)
        .set({ treasuryWallets: JSON.stringify(input.wallets) })
        .where(eq(adminConfig.id, 1));

      await writeAuditLog({
        userId:   ctx.user.id,
        userName: ctx.user.name ?? ctx.user.email ?? "admin",
        section:  "treasury",
        changes:  diffObjects(
          { treasuryWallets: oldWallets },
          { treasuryWallets: input.wallets },
        ),
      });

      return { success: true };
    }),

  /**
   * Read the audit log — admin only.
   * Returns the most recent entries, optionally filtered by section.
   * Paginated: page 1 = most recent.
   */
  getAuditLog: adminProcedure
    .input(z.object({
      section: z.enum(["fee_config", "treasury", "operator_config", "all"]).default("all"),
      page:    z.number().int().min(1).default(1),
      limit:   z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { entries: [], total: 0, page: input.page, limit: input.limit };

      const offset = (input.page - 1) * input.limit;

      const baseQuery = db
        .select()
        .from(adminAuditLog)
        .orderBy(desc(adminAuditLog.createdAt));

      const rows = input.section === "all"
        ? await baseQuery.limit(input.limit).offset(offset)
        : await db
            .select()
            .from(adminAuditLog)
            .where(eq(adminAuditLog.section, input.section))
            .orderBy(desc(adminAuditLog.createdAt))
            .limit(input.limit)
            .offset(offset);

      // Count total for pagination
      const [countRow] = await db
        .select({ count: adminAuditLog.id })
        .from(adminAuditLog);
      const total = countRow ? Number(countRow.count) : 0;

      return {
        entries: rows,
        total,
        page:    input.page,
        limit:   input.limit,
      };
    }),
});
