import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const peerBlocksRouter = router({
  /**
   * Block a peer. Idempotent — calling it again is a no-op.
   */
  block: publicProcedure
    .input(
      z.object({
        blockerPeerId: z.string().min(1).max(128),
        blockedPeerId: z.string().min(1).max(128),
        reason: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.blockerPeerId === input.blockedPeerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot block yourself" });
      }
      const { getDb } = await import("../db");
      const { peerBlocks } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { ok: false, alreadyBlocked: false };

      // Check if already blocked
      const existing = await db
        .select({ id: peerBlocks.id })
        .from(peerBlocks)
        .where(
          and(
            eq(peerBlocks.blockerPeerId, input.blockerPeerId),
            eq(peerBlocks.blockedPeerId, input.blockedPeerId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(peerBlocks).values({
          blockerPeerId: input.blockerPeerId,
          blockedPeerId: input.blockedPeerId,
          reason: input.reason ?? null,
        });
      }
      return { ok: true, alreadyBlocked: existing.length > 0 };
    }),

  /**
   * Unblock a peer.
   */
  unblock: publicProcedure
    .input(
      z.object({
        blockerPeerId: z.string().min(1).max(128),
        blockedPeerId: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerBlocks } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { ok: false };

      await db
        .delete(peerBlocks)
        .where(
          and(
            eq(peerBlocks.blockerPeerId, input.blockerPeerId),
            eq(peerBlocks.blockedPeerId, input.blockedPeerId)
          )
        );
      return { ok: true };
    }),

  /**
   * Check if a specific peer is blocked by the caller.
   */
  isBlocked: publicProcedure
    .input(
      z.object({
        blockerPeerId: z.string().min(1).max(128),
        blockedPeerId: z.string().min(1).max(128),
      })
    )
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerBlocks } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { blocked: false, reason: null, since: null };

      const rows = await db
        .select({ id: peerBlocks.id, reason: peerBlocks.reason, createdAt: peerBlocks.createdAt })
        .from(peerBlocks)
        .where(
          and(
            eq(peerBlocks.blockerPeerId, input.blockerPeerId),
            eq(peerBlocks.blockedPeerId, input.blockedPeerId)
          )
        )
        .limit(1);

      return {
        blocked: rows.length > 0,
        reason: rows[0]?.reason ?? null,
        since: rows[0]?.createdAt ?? null,
      };
    }),

  /**
   * List all peers blocked by the caller, ordered by most recently blocked.
   */
  listBlocked: publicProcedure
    .input(z.object({ blockerPeerId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerBlocks } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(peerBlocks)
        .where(eq(peerBlocks.blockerPeerId, input.blockerPeerId))
        .orderBy(desc(peerBlocks.createdAt));

      return rows;
    }),
});
