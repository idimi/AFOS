/**
 * peerMessages router
 * Handles peer-to-peer direct messages exchanged before a formal RFQ.
 * Messages are stored in the `peer_messages` table and keyed by peer IDs
 * (wallet-derived, e.g. "lp-eth-8dfa0f").
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

export const peerMessagesRouter = router({
  /**
   * Send a message from one peer to another.
   * Both fromPeerId and toPeerId are wallet-derived peer IDs.
   * No auth required — peers identify themselves by their wallet-derived ID.
   */
  send: publicProcedure
    .input(
      z.object({
        fromPeerId: z.string().min(1).max(128),
        toPeerId: z.string().min(1).max(128),
        body: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerMessages } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return { id: null, ok: false };

      const [result] = await db
        .insert(peerMessages)
        .values({
          fromPeerId: input.fromPeerId,
          toPeerId: input.toPeerId,
          body: input.body,
        })
        .$returningId();
      return { id: result.id, ok: true };
    }),

  /**
   * Get the conversation thread between two peers.
   * Returns messages in ascending chronological order.
   */
  getThread: publicProcedure
    .input(
      z.object({
        myPeerId: z.string().min(1).max(128),
        otherPeerId: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerMessages } = await import("../../drizzle/schema");
      const { and, eq, or, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const msgs = await db
        .select()
        .from(peerMessages)
        .where(
          or(
            and(
              eq(peerMessages.fromPeerId, input.myPeerId),
              eq(peerMessages.toPeerId, input.otherPeerId)
            ),
            and(
              eq(peerMessages.fromPeerId, input.otherPeerId),
              eq(peerMessages.toPeerId, input.myPeerId)
            )
          )
        )
        .orderBy(desc(peerMessages.createdAt))
        .limit(input.limit);
      // Return in ascending order for display
      return msgs.reverse();
    }),

  /**
   * Get unread message count for a given peer (messages sent TO this peer).
   */
  unreadCount: publicProcedure
    .input(z.object({ myPeerId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerMessages } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { count: 0 };

      const unread = await db
        .select()
        .from(peerMessages)
        .where(eq(peerMessages.toPeerId, input.myPeerId));
      const count = unread.filter((m: { readAt: Date | null }) => m.readAt === null).length;
      return { count };
    }),

  /**
   * Mark all messages in a thread as read.
   */
  markRead: publicProcedure
    .input(
      z.object({
        myPeerId: z.string().min(1).max(128),
        fromPeerId: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerMessages } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { ok: false };

      await db
        .update(peerMessages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(peerMessages.toPeerId, input.myPeerId),
            eq(peerMessages.fromPeerId, input.fromPeerId)
          )
        );
      return { ok: true };
    }),
});
