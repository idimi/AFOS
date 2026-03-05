/**
 * adminConfig router
 *
 * Provides get/save procedures for the operator-level platform configuration
 * stored in the admin_config singleton table (id = 1).
 *
 * Covers:
 *   - Fee configuration (swap fee bps, express fee, bot fee, min/max trade size, kill switch)
 *   - Treasury wallet list (JSON-encoded array persisted in the DB)
 *
 * get is public so the UI can load config without auth.
 * saveFeeConfig and saveTreasury require admin role.
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { adminConfig, DEFAULT_ADMIN_CONFIG } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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

// ─── Router ───────────────────────────────────────────────────────────────────
export const adminConfigRouter = router({
  /**
   * Load the current admin config.
   * Returns defaults when no row exists yet (auto-creates the singleton row).
   * Public so the admin panel can load without auth.
   */
  get: publicProcedure.query(async () => {
    const row = await getOrCreateConfig();
    if (!row) return {
      feeEnabled:       DEFAULT_ADMIN_CONFIG.feeEnabled,
      swapFeeBps:       DEFAULT_ADMIN_CONFIG.swapFeeBps,
      expressFeeBps:    DEFAULT_ADMIN_CONFIG.expressFeeBps,
      botFeeCents:      DEFAULT_ADMIN_CONFIG.botFeeCents,
      minTradeUsdCents: DEFAULT_ADMIN_CONFIG.minTradeUsdCents,
      maxTradeUsdCents: DEFAULT_ADMIN_CONFIG.maxTradeUsdCents,
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
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await getOrCreateConfig(); // ensure row exists

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
      return { success: true };
    }),

  /**
   * Save treasury wallet list — admin only.
   * Replaces the entire list (client sends the full array after add/remove/edit).
   */
  saveTreasury: adminProcedure
    .input(z.object({
      wallets: z.array(treasuryWalletSchema),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await getOrCreateConfig(); // ensure row exists
      await db.update(adminConfig)
        .set({ treasuryWallets: JSON.stringify(input.wallets) })
        .where(eq(adminConfig.id, 1));
      return { success: true };
    }),
});
