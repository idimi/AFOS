/**
 * Operator Config Router
 * Persists AFOS Oracle VM infrastructure settings to the DB.
 * All write procedures are admin-only.
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { operatorConfig, DEFAULT_OPERATOR_CONFIG } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Admin guard middleware ───────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getOrCreate() {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select().from(operatorConfig).where(eq(operatorConfig.id, 1)).limit(1);
  if (row) return row;

  // Seed defaults on first access
  await db.insert(operatorConfig).values({
    id: 1,
    llmModel:          DEFAULT_OPERATOR_CONFIG.llmModel,
    systemPrompt:      DEFAULT_OPERATOR_CONFIG.systemPrompt,
    rendezvousChannel: DEFAULT_OPERATOR_CONFIG.rendezvousChannel,
    peerMode:          DEFAULT_OPERATOR_CONFIG.peerMode,
    minSwapUsdt:       DEFAULT_OPERATOR_CONFIG.minSwapUsdt,
    maxSwapUsdt:       DEFAULT_OPERATOR_CONFIG.maxSwapUsdt,
    scBridgePort:      DEFAULT_OPERATOR_CONFIG.scBridgePort,
    btcHost:           DEFAULT_OPERATOR_CONFIG.btcHost,
    btcRpcPassword:    DEFAULT_OPERATOR_CONFIG.btcRpcPassword,
    btcTlsCert:        DEFAULT_OPERATOR_CONFIG.btcTlsCert,
    solanaRpc:         DEFAULT_OPERATOR_CONFIG.solanaRpc,
    solanaKeypairPath: DEFAULT_OPERATOR_CONFIG.solanaKeypairPath,
    tradeauto:         DEFAULT_OPERATOR_CONFIG.tradeauto ? 1 : 0,
    maxTradeBtc:       DEFAULT_OPERATOR_CONFIG.maxTradeBtc,
    feeBpsCap:         DEFAULT_OPERATOR_CONFIG.feeBpsCap,
    tickInterval:      DEFAULT_OPERATOR_CONFIG.tickInterval,
    minRefundHours:    DEFAULT_OPERATOR_CONFIG.minRefundHours,
    maxRefundHours:    DEFAULT_OPERATOR_CONFIG.maxRefundHours,
  });

  const [created] = await db.select().from(operatorConfig).where(eq(operatorConfig.id, 1)).limit(1);
  return created ?? null;
}

// ─── Input schema ─────────────────────────────────────────────────────────────
const saveSchema = z.object({
  llmModel:          z.string().min(1).max(100).optional(),
  systemPrompt:      z.string().max(2000).optional(),
  rendezvousChannel: z.string().min(1).max(200).optional(),
  peerMode:          z.enum(["maker", "taker", "maker-taker"]).optional(),
  minSwapUsdt:       z.string().regex(/^\d+(\.\d+)?$/).optional(),
  maxSwapUsdt:       z.string().regex(/^\d+(\.\d+)?$/).optional(),
  scBridgePort:      z.string().regex(/^\d{1,5}$/).optional(),
  btcHost:           z.string().max(200).optional(),
  btcRpcPassword:    z.string().max(500).optional(),
  btcTlsCert:        z.string().max(500).optional(),
  solanaRpc:         z.string().url().optional(),
  solanaKeypairPath: z.string().max(500).optional(),
  tradeauto:         z.boolean().optional(),
  maxTradeBtc:       z.string().regex(/^\d+(\.\d+)?$/).optional(),
  feeBpsCap:         z.string().regex(/^\d+$/).optional(),
  tickInterval:      z.string().regex(/^\d+$/).optional(),
  minRefundHours:    z.string().regex(/^\d+$/).optional(),
  maxRefundHours:    z.string().regex(/^\d+$/).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────
export const operatorConfigRouter = router({
  /**
   * Get operator config (readable by any authenticated user so the UI can load it).
   * Sensitive fields (btcRpcPassword) are masked before returning.
   */
  get: publicProcedure.query(async () => {
    const row = await getOrCreate();
    if (!row) return null;
    return {
      ...row,
      tradeauto: row.tradeauto === 1,
      // Mask the RPC password — never expose it to the frontend
      btcRpcPassword: row.btcRpcPassword ? "••••••••" : "",
    };
  }),

  /**
   * Save operator config — admin only.
   */
  save: adminProcedure
    .input(saveSchema)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      // Ensure row exists
      await getOrCreate();

      const patch: Record<string, unknown> = {};
      if (input.llmModel          !== undefined) patch.llmModel          = input.llmModel;
      if (input.systemPrompt      !== undefined) patch.systemPrompt      = input.systemPrompt;
      if (input.rendezvousChannel !== undefined) patch.rendezvousChannel = input.rendezvousChannel;
      if (input.peerMode          !== undefined) patch.peerMode          = input.peerMode;
      if (input.minSwapUsdt       !== undefined) patch.minSwapUsdt       = input.minSwapUsdt;
      if (input.maxSwapUsdt       !== undefined) patch.maxSwapUsdt       = input.maxSwapUsdt;
      if (input.scBridgePort      !== undefined) patch.scBridgePort      = input.scBridgePort;
      if (input.btcHost           !== undefined) patch.btcHost           = input.btcHost;
      // Only update password if user actually typed a new one (not the masked placeholder)
      if (input.btcRpcPassword !== undefined && input.btcRpcPassword !== "••••••••") {
        patch.btcRpcPassword = input.btcRpcPassword;
      }
      if (input.btcTlsCert        !== undefined) patch.btcTlsCert        = input.btcTlsCert;
      if (input.solanaRpc         !== undefined) patch.solanaRpc         = input.solanaRpc;
      if (input.solanaKeypairPath !== undefined) patch.solanaKeypairPath = input.solanaKeypairPath;
      if (input.tradeauto         !== undefined) patch.tradeauto         = input.tradeauto ? 1 : 0;
      if (input.maxTradeBtc       !== undefined) patch.maxTradeBtc       = input.maxTradeBtc;
      if (input.feeBpsCap         !== undefined) patch.feeBpsCap         = input.feeBpsCap;
      if (input.tickInterval      !== undefined) patch.tickInterval      = input.tickInterval;
      if (input.minRefundHours    !== undefined) patch.minRefundHours    = input.minRefundHours;
      if (input.maxRefundHours    !== undefined) patch.maxRefundHours    = input.maxRefundHours;

      if (Object.keys(patch).length > 0) {
        await db.update(operatorConfig).set(patch).where(eq(operatorConfig.id, 1));
      }

      const [updated] = await db.select().from(operatorConfig).where(eq(operatorConfig.id, 1)).limit(1);
      if (!updated) return null;
      return {
        ...updated,
        tradeauto: updated.tradeauto === 1,
        btcRpcPassword: updated.btcRpcPassword ? "••••••••" : "",
      };
    }),
});
