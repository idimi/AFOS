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
      const { peerMessages, peerBlocks } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const { TRPCError } = await import("@trpc/server");
      const db = await getDb();
      if (!db) return { id: null, ok: false };

      // Check if the recipient has blocked the sender
      const block = await db
        .select({ id: peerBlocks.id })
        .from(peerBlocks)
        .where(
          and(
            eq(peerBlocks.blockerPeerId, input.toPeerId),
            eq(peerBlocks.blockedPeerId, input.fromPeerId)
          )
        )
        .limit(1);

      if (block.length > 0) {
        // Return silently blocked — don't reveal to sender that they're blocked
        return { id: null, ok: false, blocked: true };
      }

      const [result] = await db
        .insert(peerMessages)
        .values({
          fromPeerId: input.fromPeerId,
          toPeerId: input.toPeerId,
          body: input.body,
        })
        .$returningId();
      return { id: result.id, ok: true, blocked: false };
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
   * Get unread message counts grouped by sender, with latest message snippet.
   * Used to show badges on peer nodes in the topology canvas and Peer Directory.
   */
  unreadBySender: publicProcedure
    .input(z.object({ myPeerId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerMessages } = await import("../../drizzle/schema");
      const { eq, isNull, and } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const unread = await db
        .select()
        .from(peerMessages)
        .where(
          and(
            eq(peerMessages.toPeerId, input.myPeerId),
            isNull(peerMessages.readAt)
          )
        )
        .orderBy(peerMessages.createdAt);

      // Group by sender
      const bySender: Record<string, { count: number; latestBody: string; latestAt: Date }> = {};
      for (const msg of unread) {
        if (!bySender[msg.fromPeerId]) {
          bySender[msg.fromPeerId] = { count: 0, latestBody: msg.body, latestAt: msg.createdAt };
        }
        bySender[msg.fromPeerId].count++;
        bySender[msg.fromPeerId].latestBody = msg.body;
        bySender[msg.fromPeerId].latestAt = msg.createdAt;
      }

      return Object.entries(bySender).map(([fromPeerId, v]) => ({
        fromPeerId,
        count: v.count,
        snippet: v.latestBody.slice(0, 60) + (v.latestBody.length > 60 ? '…' : ''),
        latestAt: v.latestAt,
      }));
    }),

  /**
   * Mark ALL unread messages addressed to myPeerId as read.
   * Called when the user navigates to the Network page.
   */
  markAllRead: publicProcedure
    .input(z.object({ myPeerId: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { peerMessages } = await import("../../drizzle/schema");
      const { eq, isNull } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { ok: false, updated: 0 };

      const result = await db
        .update(peerMessages)
        .set({ readAt: new Date() })
        .where(
          eq(peerMessages.toPeerId, input.myPeerId)
        );
      return { ok: true };
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
