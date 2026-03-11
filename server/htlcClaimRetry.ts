/**
 * HTLC Claim Retry Queue
 *
 * When claimSolanaHtlc fails (RPC timeout, network blip, etc.) after the secret
 * has already been revealed, funds stay locked in the HTLC until the timelock
 * expires. This module provides:
 *
 *  1. An in-memory retry queue that automatically retries failed claims with
 *     exponential backoff (up to MAX_ATTEMPTS attempts).
 *  2. A `enqueueClaimRetry()` function called by revealHtlcSecret on failure.
 *  3. A `retryClaimNow()` function for manual admin-triggered retries.
 *  4. A `getRetryQueue()` function to inspect pending retries.
 *
 * Retry schedule (exponential backoff, jitter ±10%):
 *   Attempt 1: 30s
 *   Attempt 2: 60s
 *   Attempt 3: 120s
 *   Attempt 4: 300s (5 min)
 *   Attempt 5: 600s (10 min) — final attempt
 */

import { claimSolanaHtlc } from "./solanaHtlcClaim";

/** Parameters for a Solana HTLC claim — mirrors the claimSolanaHtlc params shape */
export type SolanaHtlcClaimParams = {
  htlcId: string;
  secretHex: string;
  recipientAddress: string;
  tokenSymbol?: string;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClaimRetryJob {
  rfqId: string;
  params: SolanaHtlcClaimParams;
  /** Which claim this is: "initiator" (Agent A's lock → counterparty) or "counterparty" (Agent B's lock → initiator) */
  side: "initiator" | "counterparty";
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: number | null;
  nextRetryAt: number;
  lastError: string | null;
  status: "pending" | "retrying" | "succeeded" | "exhausted";
  createdAt: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000; // 30s
const BACKOFF_MULTIPLIER = 2;
const JITTER_FACTOR = 0.1; // ±10%

/** Compute next retry delay with exponential backoff + jitter */
function nextDelayMs(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

// ─── In-Memory Queue ──────────────────────────────────────────────────────────

const retryQueue = new Map<string, ClaimRetryJob>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Unique key for a retry job: rfqId + side */
function jobKey(rfqId: string, side: "initiator" | "counterparty"): string {
  return `${rfqId}:${side}`;
}

/**
 * Enqueue a failed claim for automatic retry.
 * If a job already exists for this rfqId+side, it is updated (not duplicated).
 */
export function enqueueClaimRetry(
  rfqId: string,
  side: "initiator" | "counterparty",
  params: SolanaHtlcClaimParams,
  error: string,
): void {
  const key = jobKey(rfqId, side);
  const existing = retryQueue.get(key);
  const attempts = existing ? existing.attempts : 0;

  if (existing && existing.status === "succeeded") {
    console.log(`[ClaimRetry] Job ${key} already succeeded — skipping re-enqueue`);
    return;
  }
  if (existing && existing.status === "exhausted") {
    console.warn(`[ClaimRetry] Job ${key} already exhausted — not re-enqueuing`);
    return;
  }
  if (attempts >= MAX_ATTEMPTS) {
    console.error(`[ClaimRetry] Job ${key} reached max attempts (${MAX_ATTEMPTS}) — marking exhausted`);
    if (existing) {
      existing.status = "exhausted";
      existing.lastError = error;
    }
    return;
  }

  const delay = nextDelayMs(attempts + 1);
  const job: ClaimRetryJob = {
    rfqId,
    params,
    side,
    attempts,
    maxAttempts: MAX_ATTEMPTS,
    lastAttemptAt: existing?.lastAttemptAt ?? null,
    nextRetryAt: Date.now() + delay,
    lastError: error,
    status: "pending",
    createdAt: existing?.createdAt ?? Date.now(),
  };
  retryQueue.set(key, job);

  // Cancel any existing timer for this job
  const existingTimer = retryTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => executeRetry(key), delay);
  retryTimers.set(key, timer);

  console.log(
    `[ClaimRetry] Enqueued ${key} — attempt ${attempts + 1}/${MAX_ATTEMPTS} in ${Math.round(delay / 1000)}s. Error: ${error}`,
  );
}

/** Execute a single retry attempt */
async function executeRetry(key: string): Promise<void> {
  const job = retryQueue.get(key);
  if (!job) return;
  if (job.status === "succeeded" || job.status === "exhausted") return;

  job.status = "retrying";
  job.attempts += 1;
  job.lastAttemptAt = Date.now();
  retryTimers.delete(key);

  console.log(`[ClaimRetry] Attempting claim for ${key} (attempt ${job.attempts}/${job.maxAttempts})`);

  try {
    const result = await claimSolanaHtlc(job.params);
    job.status = "succeeded";
    job.lastError = null;
    console.log(`[ClaimRetry] ✓ Claim succeeded for ${key} — tx: ${result.txSignature}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    job.lastError = errMsg;
    console.error(`[ClaimRetry] ✗ Claim failed for ${key} (attempt ${job.attempts}): ${errMsg}`);

    if (job.attempts >= job.maxAttempts) {
      job.status = "exhausted";
      console.error(`[ClaimRetry] Job ${key} exhausted after ${job.maxAttempts} attempts — manual intervention required`);
    } else {
      // Re-enqueue with backoff
      job.status = "pending";
      const delay = nextDelayMs(job.attempts + 1);
      job.nextRetryAt = Date.now() + delay;
      const timer = setTimeout(() => executeRetry(key), delay);
      retryTimers.set(key, timer);
      console.log(`[ClaimRetry] Scheduled next retry for ${key} in ${Math.round(delay / 1000)}s`);
    }
  }
}

/**
 * Manually trigger an immediate retry for a specific rfqId + side.
 * Used by the admin panel's "Retry Claim" button.
 * Returns the updated job after the attempt.
 */
export async function retryClaimNow(
  rfqId: string,
  side: "initiator" | "counterparty",
): Promise<ClaimRetryJob | null> {
  const key = jobKey(rfqId, side);
  const job = retryQueue.get(key);
  if (!job) return null;

  // Cancel any pending timer
  const timer = retryTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(key);
  }

  // Reset status so executeRetry will run
  job.status = "pending";
  job.nextRetryAt = Date.now();
  await executeRetry(key);
  return retryQueue.get(key) ?? null;
}

/**
 * Get all jobs in the retry queue (for admin inspection).
 * Returns a serialisable snapshot (no function references).
 */
export function getRetryQueue(): Omit<ClaimRetryJob, "params">[] {
  return Array.from(retryQueue.values()).map(({ params: _params, ...rest }) => rest);
}

/**
 * Get a single job by rfqId + side (for admin inspection).
 */
export function getRetryJob(
  rfqId: string,
  side: "initiator" | "counterparty",
): Omit<ClaimRetryJob, "params"> | null {
  const key = jobKey(rfqId, side);
  const job = retryQueue.get(key);
  if (!job) return null;
  const { params: _params, ...rest } = job;
  return rest;
}
