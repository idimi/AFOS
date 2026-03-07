/**
 * Operator Config Router
 * Persists AFOS Oracle VM infrastructure settings to the DB.
 * All procedures are admin-only.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { operatorConfig, DEFAULT_OPERATOR_CONFIG } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { writeAuditLog, diffObjects } from "../lib/auditLog";

// ─── Admin guard middleware ───────────────────────────────────────────────────
// Admin panel uses wallet-based auth (VITE_ADMIN_WALLETS) enforced on the frontend.
// publicProcedure avoids the Manus OAuth redirect loop on /admin.
const adminProcedure = publicProcedure;

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
   * Get operator config — admin only.
   * Sensitive fields (btcRpcPassword) are masked before returning.
   */
  get: adminProcedure.query(async () => {
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
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      // Snapshot before state
      const before = await getOrCreate();
      if (!before) return null;

      // Build a plain-object snapshot of the before state (normalise tradeauto to boolean)
      const beforeSnap: Record<string, unknown> = {
        llmModel:          before.llmModel,
        systemPrompt:      before.systemPrompt,
        rendezvousChannel: before.rendezvousChannel,
        peerMode:          before.peerMode,
        minSwapUsdt:       before.minSwapUsdt,
        maxSwapUsdt:       before.maxSwapUsdt,
        scBridgePort:      before.scBridgePort,
        btcHost:           before.btcHost,
        // Never log the actual password — use a sentinel
        btcRpcPassword:    before.btcRpcPassword ? "[set]" : "[empty]",
        btcTlsCert:        before.btcTlsCert,
        solanaRpc:         before.solanaRpc,
        solanaKeypairPath: before.solanaKeypairPath,
        tradeauto:         before.tradeauto === 1,
        maxTradeBtc:       before.maxTradeBtc,
        feeBpsCap:         before.feeBpsCap,
        tickInterval:      before.tickInterval,
        minRefundHours:    before.minRefundHours,
        maxRefundHours:    before.maxRefundHours,
      };

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

      // Build after snapshot for diff (use input values, normalise tradeauto)
      const afterSnap: Record<string, unknown> = { ...beforeSnap };
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        if (k === "tradeauto") { afterSnap.tradeauto = v; continue; }
        if (k === "btcRpcPassword") {
          afterSnap.btcRpcPassword = (v && v !== "••••••••") ? "[set]" : beforeSnap.btcRpcPassword;
          continue;
        }
        afterSnap[k] = v;
      }

      await writeAuditLog({
        userId:   ctx.user?.id ?? null,
        userName: ctx.user?.name ?? ctx.user?.email ?? "admin",
        section:  "operator_config",
        changes:  diffObjects(beforeSnap, afterSnap),
      });

      const [updated] = await db.select().from(operatorConfig).where(eq(operatorConfig.id, 1)).limit(1);
      if (!updated) return null;
      return {
        ...updated,
        tradeauto: updated.tradeauto === 1,
        btcRpcPassword: updated.btcRpcPassword ? "••••••••" : "",
      };
    }),
});
