import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { peerMutes } from "../../drizzle/schema";
import { and, eq, desc } from "drizzle-orm";
export const peerMutesRouter = router({
  /** Mute a peer — hides their notifications without blocking messages */
  mute: publicProcedure
    .input(z.object({
      muterPeerId: z.string().min(1).max(128),
      mutedPeerId: z.string().min(1).max(128),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      // Upsert — ignore if already muted
      const existing = await db
        .select()
        .from(peerMutes)
        .where(and(
          eq(peerMutes.muterPeerId, input.muterPeerId),
          eq(peerMutes.mutedPeerId, input.mutedPeerId),
        ));
      if (existing.length === 0) {
        await db.insert(peerMutes).values({
          muterPeerId: input.muterPeerId,
          mutedPeerId: input.mutedPeerId,
        });
      }
      return { success: true };
    }),

  /** Unmute a peer */
  unmute: publicProcedure
    .input(z.object({
      muterPeerId: z.string().min(1).max(128),
      mutedPeerId: z.string().min(1).max(128),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db
        .delete(peerMutes)
        .where(and(
          eq(peerMutes.muterPeerId, input.muterPeerId),
          eq(peerMutes.mutedPeerId, input.mutedPeerId),
        ));
      return { success: true };
    }),

  /** Check if a specific peer is muted */
  isMuted: publicProcedure
    .input(z.object({
      muterPeerId: z.string().min(1).max(128),
      mutedPeerId: z.string().min(1).max(128),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { muted: false };
      const rows = await db
        .select()
        .from(peerMutes)
        .where(and(
          eq(peerMutes.muterPeerId, input.muterPeerId),
          eq(peerMutes.mutedPeerId, input.mutedPeerId),
        ));
      return { muted: rows.length > 0 };
    }),

  /** List all peers muted by a given peer ID */
  listMuted: publicProcedure
    .input(z.object({ muterPeerId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(peerMutes)
        .where(eq(peerMutes.muterPeerId, input.muterPeerId))
        .orderBy(desc(peerMutes.createdAt));
    }),

  /** Clear ALL mutes set by this peer. Used in the Danger Zone of Settings. */
  clearAll: publicProcedure
    .input(z.object({ muterPeerId: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: false, deleted: 0 };
      const result = await db
        .delete(peerMutes)
        .where(eq(peerMutes.muterPeerId, input.muterPeerId));
      return { ok: true, deleted: (result as any).affectedRows ?? 0 };
    }),
});
