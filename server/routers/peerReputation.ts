/**
 * Peer Reputation Router
 *
 * Provides tRPC procedures for:
 *  - Fetching reputation scores for a list of peer IDs
 *  - Recording a ping result (called from the Network page Ping button)
 *  - Fetching the full reputation leaderboard
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  recordPeerPing,
  recordPeerSwap,
  getPeerReputations,
  getAllPeerReputations,
} from "../db";

export const peerReputationRouter = router({
  /**
   * Get reputation scores for a list of peer IDs.
   * Returns a record: peerId → { score, successfulSwaps, successfulPings, failedPings, avgLatencyMs }
   */
  getScores: publicProcedure
    .input(z.object({ peerIds: z.array(z.string()).max(200) }))
    .query(async ({ input }) => {
      const map = await getPeerReputations(input.peerIds);
      const result: Record<string, {
        score: number;
        successfulSwaps: number;
        successfulPings: number;
        failedPings: number;
        avgLatencyMs: number | null;
      }> = {};
      for (const [id, r] of Array.from(map.entries())) {
        result[id] = {
          score: r.score,
          successfulSwaps: r.successfulSwaps,
          successfulPings: r.successfulPings,
          failedPings: r.failedPings,
          avgLatencyMs: r.successfulPings > 0
            ? Math.round(r.totalLatencyMs / r.successfulPings)
            : null,
        };
      }
      return result;
    }),

  /**
   * Get all peer reputations ordered by score descending.
   * Used for the leaderboard view.
   */
  getAll: publicProcedure.query(async () => {
    const rows = await getAllPeerReputations();
    return rows.map(r => ({
      peerId: r.peerId,
      alias: r.alias,
      origin: r.origin,
      score: r.score,
      successfulSwaps: r.successfulSwaps,
      successfulPings: r.successfulPings,
      failedPings: r.failedPings,
      avgLatencyMs: r.successfulPings > 0
        ? Math.round(r.totalLatencyMs / r.successfulPings)
        : null,
      lastSeenAt: r.lastSeenAt,
    }));
  }),

  /**
   * Record a ping result for a peer.
   * Called by the frontend Ping button after receiving the Oracle VM response.
   */
  recordPing: publicProcedure
    .input(z.object({
      peerId: z.string(),
      alias: z.string().optional(),
      origin: z.string().default("hyperswarm"),
      latencyMs: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      const updated = await recordPeerPing(
        input.peerId,
        input.alias,
        input.origin,
        input.latencyMs,
      );
      return {
        success: true,
        score: updated?.score ?? null,
      };
    }),

  /**
   * Record a successful swap for a peer (called internally after swap settlement).
   */
  recordSwap: publicProcedure
    .input(z.object({ peerId: z.string() }))
    .mutation(async ({ input }) => {
      await recordPeerSwap(input.peerId);
      return { success: true };
    }),
});
