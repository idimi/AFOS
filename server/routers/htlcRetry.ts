/**
 * htlcRetry router
 *
 * Admin-only procedures for inspecting and manually triggering retries
 * of failed HTLC claim transactions.
 *
 * Use when a claimSolanaHtlc call fails after the secret has been revealed
 * and funds remain locked in the HTLC program.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getRetryQueue, getRetryJob, retryClaimNow } from "../htlcClaimRetry";

// ─── Admin guard ──────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Router ───────────────────────────────────────────────────────────────────
export const htlcRetryRouter = router({
  /**
   * List all jobs in the retry queue (pending, retrying, succeeded, exhausted).
   * Admin only.
   */
  listQueue: adminProcedure.query(() => {
    return getRetryQueue();
  }),

  /**
   * Get a single retry job by rfqId + side.
   * Admin only.
   */
  getJob: adminProcedure
    .input(
      z.object({
        rfqId: z.string(),
        side: z.enum(["initiator", "counterparty"]),
      }),
    )
    .query(({ input }) => {
      const job = getRetryJob(input.rfqId, input.side);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No retry job found for rfqId=${input.rfqId} side=${input.side}` });
      }
      return job;
    }),

  /**
   * Manually trigger an immediate retry for a specific rfqId + side.
   * Cancels any pending timer and fires the claim attempt right now.
   * Admin only.
   */
  retryNow: adminProcedure
    .input(
      z.object({
        rfqId: z.string(),
        side: z.enum(["initiator", "counterparty"]),
      }),
    )
    .mutation(async ({ input }) => {
      const job = await retryClaimNow(input.rfqId, input.side);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No retry job found for rfqId=${input.rfqId} side=${input.side}. The claim may not have failed or the job was already cleaned up.`,
        });
      }
      return {
        rfqId: job.rfqId,
        side: job.side,
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
      };
    }),
});
