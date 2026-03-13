/**
 * Helius Webhook Integration for AFOS HTLC Program
 *
 * Registers a Helius "raw" webhook on the AFOS HTLC program address so the
 * server receives real-time notifications when a lock, claim, or refund
 * instruction executes on-chain — eliminating the need for constant polling.
 *
 * Webhook lifecycle:
 *  - On startup: calls `ensureHeliusWebhook()` which creates or updates the
 *    webhook to point at `POST /api/webhooks/helius-htlc` on the live domain.
 *  - On each event: `processHtlcEvent()` parses the payload, identifies the
 *    instruction type via Anchor discriminator, and:
 *      • For lock events: looks up the htlc_secrets row by rfqId and triggers
 *        immediate auto-claims (same logic as notifyAgentBLocked) when both
 *        sides are locked.
 *      • For claim/refund events: updates the htlc_swaps DB record.
 *
 * Security: Helius sends an `authorization` header with the webhook secret.
 *   Set HELIUS_WEBHOOK_SECRET in env; if unset, signature check is skipped
 *   (acceptable for dev but should be set in production).
 */

import type { Express, Request, Response } from "express";
import { getDb } from "../db.js";
import { htlcSwaps, htlcSecrets } from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { ENV } from "../_core/env.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const AFOS_HTLC_PROGRAM_ID = "XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW";
const HELIUS_WEBHOOKS_API = "https://api.helius.xyz/v0/webhooks";

// Anchor discriminators (first 8 bytes of SHA256("global:<instruction_name>"))
// Must match afosHtlcProgram.ts on the frontend
const DISCRIMINATORS = {
  lockSol:   [181, 15, 15, 99, 159, 87, 241, 42],
  lockToken: [153, 150, 141, 190, 78, 115, 232, 80],
  claim:     [62, 198, 214, 193, 213, 159, 108, 210],
  refund:    [2, 96, 183, 251, 63, 208, 46, 46],
};

// ── Webhook registration ──────────────────────────────────────────────────────

/**
 * Called once at server startup. Creates or updates the Helius webhook so it
 * points at the current live domain's `/api/webhooks/helius-htlc` endpoint.
 *
 * Uses `webhookType: "raw"` so we receive ALL transactions involving the HTLC
 * program, regardless of whether Helius has a named parser for our custom
 * instruction types.
 */
export async function ensureHeliusWebhook(appBaseUrl: string): Promise<void> {
  const apiKey = ENV.heliusApiKey;
  if (!apiKey) {
    console.warn("[HeliusWebhook] HELIUS_API_KEY not set — skipping webhook registration.");
    return;
  }

  // Always use the production domain for the webhook URL so Helius can reach it.
  // The dev tunnel URL changes on every restart and is not reachable by Helius.
  const PROD_DOMAIN = "https://afos.trade";
  const webhookUrl = `${PROD_DOMAIN}/api/webhooks/helius-htlc`;
  const secret = process.env.HELIUS_WEBHOOK_SECRET ?? "";

  const body = {
    webhookURL: webhookUrl,
    transactionTypes: ["ANY"],
    accountAddresses: [AFOS_HTLC_PROGRAM_ID],
    webhookType: "raw",
    txnStatus: "all",
    ...(secret ? { authHeader: secret } : {}),
  };

  try {
    // 1. List existing webhooks — find ours by program address
    const listRes = await fetch(`${HELIUS_WEBHOOKS_API}?api-key=${apiKey}`);
    if (!listRes.ok) {
      console.warn("[HeliusWebhook] Failed to list webhooks:", listRes.status, await listRes.text());
      return;
    }
    const existing: HeliusWebhook[] = await listRes.json();

    // 2. Match by program address (most reliable) or by our known prod URL
    const match = existing.find(w =>
      (w.accountAddresses ?? []).includes(AFOS_HTLC_PROGRAM_ID) ||
      w.webhookURL === webhookUrl
    );

    if (match) {
      // 3a. Already exists — update if anything is stale
      const alreadyCorrect =
        match.webhookURL === webhookUrl &&
        (match.accountAddresses ?? []).includes(AFOS_HTLC_PROGRAM_ID) &&
        (!secret || (match as unknown as Record<string, unknown>).authHeader === secret);
      if (alreadyCorrect) {
        setWebhookId(match.webhookID, webhookUrl);
        console.log(`[HeliusWebhook] Webhook already configured (id: ${match.webhookID}) → ${webhookUrl}`);
        return;
      }
      const updateRes = await fetch(`${HELIUS_WEBHOOKS_API}/${match.webhookID}?api-key=${apiKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (updateRes.ok) {
        const updated: HeliusWebhook = await updateRes.json();
        setWebhookId(updated.webhookID, webhookUrl);
        console.log(`[HeliusWebhook] Updated webhook ${updated.webhookID} → ${webhookUrl} | addresses: ${updated.accountAddresses}`);
      } else {
        console.warn("[HeliusWebhook] Failed to update webhook:", updateRes.status, await updateRes.text());
      }
    } else {
      // 3b. Create new webhook
      const createRes = await fetch(`${HELIUS_WEBHOOKS_API}?api-key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (createRes.ok) {
        const created: HeliusWebhook = await createRes.json();
        setWebhookId(created.webhookID, webhookUrl);
        console.log(`[HeliusWebhook] Created webhook ${created.webhookID} → ${webhookUrl} | addresses: ${created.accountAddresses}`);
      } else {
        console.warn("[HeliusWebhook] Failed to create webhook:", createRes.status, await createRes.text());
      }
    }
  } catch (err) {
    console.error("[HeliusWebhook] Registration error:", err);
  }
}

// ── Webhook status tracking ──────────────────────────────────────────────────

const webhookStatus = {
  webhookId: null as string | null,
  registeredUrl: null as string | null,
  lastEventAt: null as number | null,
  lastEventSig: null as string | null,
  totalEventsReceived: 0,
  totalClaimsTriggered: 0,
  lastClaimTriggeredAt: null as number | null,
};

export function setWebhookId(id: string, url: string): void {
  webhookStatus.webhookId = id;
  webhookStatus.registeredUrl = url;
}

export function getWebhookStatus() {
  return { ...webhookStatus };
}

// ── Express route handler ─────────────────────────────────────────────────────

/**
 * Registers `POST /api/webhooks/helius-htlc` and `GET /api/webhooks/helius-htlc/status`
 * on the Express app. Must be called before Vite middleware.
 */
export function registerHeliusWebhookRoute(app: Express): void {
  // Status endpoint — shows webhook health at a glance
  app.get("/api/webhooks/helius-htlc/status", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      webhookId: webhookStatus.webhookId,
      registeredUrl: webhookStatus.registeredUrl,
      programAddress: AFOS_HTLC_PROGRAM_ID,
      lastEventAt: webhookStatus.lastEventAt,
      lastEventAgo: webhookStatus.lastEventAt
        ? `${Math.round((Date.now() - webhookStatus.lastEventAt) / 1000)}s ago`
        : null,
      lastEventSig: webhookStatus.lastEventSig,
      totalEventsReceived: webhookStatus.totalEventsReceived,
      totalClaimsTriggered: webhookStatus.totalClaimsTriggered,
      lastClaimTriggeredAt: webhookStatus.lastClaimTriggeredAt,
      secretConfigured: !!process.env.HELIUS_WEBHOOK_SECRET,
    });
  });

  app.post("/api/webhooks/helius-htlc", async (req: Request, res: Response) => {
    // 1. Verify authorization header (optional but recommended in production)
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    if (secret) {
      const authHeader = req.headers["authorization"] ?? req.headers["authheader"];
      if (authHeader !== secret) {
        console.warn("[HeliusWebhook] Unauthorized webhook request — bad secret");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    // 2. Parse payload — Helius sends an array of enhanced/raw transaction objects
    const events: HeliusRawEvent[] = Array.isArray(req.body) ? req.body : [req.body];

    let processed = 0;
    for (const event of events) {
      try {
        await processHtlcEvent(event);
        processed++;
        // Track last event for status endpoint
        webhookStatus.totalEventsReceived++;
        webhookStatus.lastEventAt = Date.now();
        webhookStatus.lastEventSig = event.signature ?? event.transaction?.signatures?.[0] ?? null;
      } catch (err) {
        console.error("[HeliusWebhook] Error processing event:", err, JSON.stringify(event).slice(0, 200));
      }
    }

    res.json({ ok: true, processed });
  });

  console.log("[HeliusWebhook] Route registered: POST /api/webhooks/helius-htlc");
}

// ── Event processing ──────────────────────────────────────────────────────────

async function processHtlcEvent(event: HeliusRawEvent): Promise<void> {
  const sig = event.signature ?? event.transaction?.signatures?.[0];
  if (!sig) return;

  // Only process successful transactions
  if (event.transactionError) {
    console.log(`[HeliusWebhook] Skipping failed tx: ${sig.slice(0, 16)}…`);
    return;
  }

  // Extract all instructions involving our program
  const instructions = extractProgramInstructions(event);
  if (instructions.length === 0) return;

  for (const ix of instructions) {
    const instructionType = identifyInstruction(ix.data);
    if (!instructionType) continue;

    console.log(`[HeliusWebhook] Detected ${instructionType} instruction in tx ${sig.slice(0, 16)}…`);

    // The first account in the instruction is typically the HTLC PDA
    const htlcPda = ix.accounts?.[0];
    if (!htlcPda) continue;

    const database = await getDb();
    if (!database) {
      console.warn("[HeliusWebhook] No DB connection — cannot process HTLC event");
      return;
    }

    if (instructionType === "claim") {
      // Update htlc_swaps: status → completed
      await database.update(htlcSwaps)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(htlcSwaps.htlcAddress, htlcPda));
      console.log(`[HeliusWebhook] Marked HTLC ${htlcPda.slice(0, 12)}… as completed (tx: ${sig.slice(0, 16)}…)`);

    } else if (instructionType === "refund") {
      // Update htlc_swaps: status → refunded, refundTxId set
      await database.update(htlcSwaps)
        .set({ status: "refunded", refundTxId: sig, refundedAt: new Date(), updatedAt: new Date() })
        .where(eq(htlcSwaps.htlcAddress, htlcPda));
      console.log(`[HeliusWebhook] Marked HTLC ${htlcPda.slice(0, 12)}… as refunded (tx: ${sig.slice(0, 16)}…)`);

    } else if (instructionType === "lockSol" || instructionType === "lockToken") {
      // Update htlc_swaps: lockTxId set
      await database.update(htlcSwaps)
        .set({ lockTxId: sig, updatedAt: new Date() })
        .where(eq(htlcSwaps.htlcAddress, htlcPda));
      console.log(`[HeliusWebhook] Recorded lock tx for HTLC ${htlcPda.slice(0, 12)}… (tx: ${sig.slice(0, 16)}…)`);

      // ── AUTO-CLAIM TRIGGER ──────────────────────────────────────────────
      // When we detect a lock event, check if this is Agent B's lock.
      // If so, both HTLCs are now locked and we can trigger immediate claims.
      // This is the key feature: settlement happens even if Agent B's browser is closed.
      await tryAutoClaimOnLock(database, htlcPda, sig);
    }
  }
}

// ── Auto-claim logic ──────────────────────────────────────────────────────────

/**
 * After detecting a lock event on-chain, look up the htlc_swaps row by PDA
 * address to find the rfqId, then check htlc_secrets to see if both sides
 * are locked and the secret is available. If so, trigger immediate claims.
 *
 * This mirrors the logic in `notifyAgentBLocked` (chat.ts) but is triggered
 * by on-chain events via Helius instead of Agent B's browser.
 */
async function tryAutoClaimOnLock(
  database: Awaited<ReturnType<typeof getDb>>,
  htlcPda: string,
  lockTxSig: string,
): Promise<void> {
  if (!database) return;

  try {
    // 1. Find the htlc_swaps row for this PDA
    const [swapRow] = await database
      .select()
      .from(htlcSwaps)
      .where(eq(htlcSwaps.htlcAddress, htlcPda))
      .limit(1);

    if (!swapRow?.rfqId) {
      console.log(`[HeliusWebhook] No htlc_swaps row found for PDA ${htlcPda.slice(0, 12)}… — skipping auto-claim`);
      return;
    }

    const rfqId = swapRow.rfqId;

    // 2. Check if this is Agent B's HTLC (htlcId starts with "htlc_b_")
    const isAgentB = swapRow.htlcId?.startsWith("htlc_b_");
    if (!isAgentB) {
      console.log(`[HeliusWebhook] Lock event for Agent A's HTLC (rfqId=${rfqId.slice(0, 12)}…) — waiting for Agent B`);
      return;
    }

    // 3. Look up the htlc_secrets row for this rfqId
    const [secretRow] = await database
      .select()
      .from(htlcSecrets)
      .where(eq(htlcSecrets.rfqId, rfqId))
      .limit(1);

    if (!secretRow) {
      console.log(`[HeliusWebhook] No htlc_secrets row for rfqId=${rfqId.slice(0, 12)}… — cannot auto-claim`);
      return;
    }

    // 4. Guard: only fire if the swap is still in progress
    if (secretRow.status === "completed" || secretRow.status === "refunded" || secretRow.status === "expired") {
      console.log(`[HeliusWebhook] rfqId=${rfqId.slice(0, 12)}… already ${secretRow.status} — skipping`);
      return;
    }

    // 5. Resolve wallet addresses
    const initiatorAddress = secretRow.initiatorAddress ?? "";
    const counterpartyAddress = secretRow.counterpartyAddress ?? swapRow.senderAddress ?? "";

    if (!initiatorAddress) {
      console.warn(`[HeliusWebhook] Missing initiatorAddress for rfqId=${rfqId.slice(0, 12)}… — cannot auto-claim`);
      return;
    }
    if (!counterpartyAddress) {
      console.warn(`[HeliusWebhook] Missing counterpartyAddress for rfqId=${rfqId.slice(0, 12)}… — cannot auto-claim`);
      return;
    }

    // 6. Update status to 'revealed' and persist counterpartyAddress
    await database.update(htlcSecrets)
      .set({
        status: "revealed",
        counterpartyAddress,
        lockTxId: lockTxSig,
        updatedAt: new Date(),
      })
      .where(eq(htlcSecrets.rfqId, rfqId));

    console.log(`[HeliusWebhook] Agent B locked on-chain — triggering immediate claims for rfqId=${rfqId.slice(0, 12)}…`);

    // 7. Derive HTLC IDs
    const htlcIdA = `htlc_a_${rfqId.slice(0, 22)}`;
    const htlcIdB = `htlc_b_${rfqId.slice(0, 22)}`;

    // 8. Determine token symbols
    const SPL_TOKENS = new Set(["USDT", "USDC"]);
    const fromTokenSym = secretRow.fromToken?.toUpperCase() ?? "SOL";
    const toTokenSym   = secretRow.toToken?.toUpperCase()   ?? "SOL";
    const tokenSymA    = SPL_TOKENS.has(fromTokenSym) ? fromTokenSym : undefined;
    const tokenSymB    = SPL_TOKENS.has(toTokenSym)   ? toTokenSym   : undefined;

    // Track claim trigger
    webhookStatus.totalClaimsTriggered++;
    webhookStatus.lastClaimTriggeredAt = Date.now();

    // 9. Fire-and-forget: trigger both claims immediately
    void (async () => {
      try {
        const { claimSolanaHtlc } = await import("../solanaHtlcClaim.js");

        // Claim Agent A's lock → release to Agent B
        const claimA = await claimSolanaHtlc({
          htlcId:           htlcIdA,
          secretHex:        secretRow.secretHex,
          recipientAddress: counterpartyAddress,
          tokenSymbol:      tokenSymA,
        });
        console.log(`[HeliusWebhook] Claimed Agent A (${fromTokenSym}) → Agent B: ${claimA.txSignature}`);

        // Claim Agent B's lock → release to Agent A
        const claimB = await claimSolanaHtlc({
          htlcId:           htlcIdB,
          secretHex:        secretRow.secretHex,
          recipientAddress: initiatorAddress,
          tokenSymbol:      tokenSymB,
        });
        console.log(`[HeliusWebhook] Claimed Agent B (${toTokenSym}) → Agent A: ${claimB.txSignature}`);

        // Mark as completed with settledAt timestamp
        const now = new Date();
        await database!.update(htlcSecrets)
          .set({
            status: "completed",
            revealTxId: claimA.txSignature,
            settledAt: now,
            settledVia: "helius_webhook",
            updatedAt: now,
          })
          .where(eq(htlcSecrets.rfqId, rfqId));

        // Also update both htlc_swaps rows
        await database!.update(htlcSwaps)
          .set({ status: "completed", updatedAt: now })
          .where(eq(htlcSwaps.rfqId, rfqId));

        const settlementMs = now.getTime() - new Date(secretRow.createdAt).getTime();
        console.log(`[HeliusWebhook] Swap rfqId=${rfqId.slice(0, 12)}… completed via Helius webhook in ${(settlementMs / 1000).toFixed(1)}s`);
      } catch (err) {
        // Non-fatal: HtlcSecretsMonitor will retry after 5 minutes
        const msg = err instanceof Error ? err.message : String(err);
        // Check if already claimed/refunded — treat as success
        if (msg.includes("already") || msg.includes("0x1774") || msg.includes("0x1775") ||
            msg.includes("Custom: 6004") || msg.includes("Custom: 6005")) {
          console.log(`[HeliusWebhook] HTLC already settled on-chain for rfqId=${rfqId.slice(0, 12)}… — marking completed`);
          await database!.update(htlcSecrets)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(htlcSecrets.rfqId, rfqId));
          await database!.update(htlcSwaps)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(htlcSwaps.rfqId, rfqId));
        } else {
          console.error(`[HeliusWebhook] Auto-claim failed for rfqId=${rfqId.slice(0, 12)}…:`, msg);
        }
      }
    })();
  } catch (err) {
    console.error("[HeliusWebhook] tryAutoClaimOnLock error:", err);
  }
}

// ── Instruction identification ────────────────────────────────────────────────

function identifyInstruction(data: string | number[] | undefined): keyof typeof DISCRIMINATORS | null {
  if (!data) return null;

  // Helius raw events encode instruction data as base58 or base64 strings, or byte arrays
  let bytes: number[];
  if (typeof data === "string") {
    // Try base58 decode (Solana standard)
    try {
      bytes = Array.from(decodeBase58(data));
    } catch {
      return null;
    }
  } else if (Array.isArray(data)) {
    bytes = data;
  } else {
    return null;
  }

  if (bytes.length < 8) return null;
  const prefix = bytes.slice(0, 8);

  for (const [name, disc] of Object.entries(DISCRIMINATORS)) {
    if (disc.every((b, i) => b === prefix[i])) {
      return name as keyof typeof DISCRIMINATORS;
    }
  }
  return null;
}

function extractProgramInstructions(event: HeliusRawEvent): HeliusInstruction[] {
  const result: HeliusInstruction[] = [];

  // Check top-level instructions
  const ixs = event.instructions ?? event.transaction?.message?.instructions ?? [];
  for (const ix of ixs) {
    if (ix.programId === AFOS_HTLC_PROGRAM_ID) {
      result.push(ix);
    }
    // Check inner instructions
    for (const inner of ix.innerInstructions ?? []) {
      if (inner.programId === AFOS_HTLC_PROGRAM_ID) {
        result.push(inner);
      }
    }
  }

  // Also check event.innerInstructions at top level
  for (const innerGroup of event.innerInstructions ?? []) {
    for (const ix of innerGroup.instructions ?? []) {
      if (ix.programId === AFOS_HTLC_PROGRAM_ID) {
        result.push(ix);
      }
    }
  }

  return result;
}

// ── Base58 decoder (no external dep) ─────────────────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(input: string): Uint8Array {
  const bytes = [0];
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Invalid base58 character: ${char}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Add leading zeros for leading '1's in input
  for (const char of input) {
    if (char === "1") bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}

// ── Type definitions ──────────────────────────────────────────────────────────

interface HeliusWebhook {
  webhookID: string;
  webhookURL: string;
  accountAddresses?: string[];
  webhookType?: string;
}

interface HeliusInstruction {
  programId: string;
  accounts?: string[];
  data?: string | number[];
  innerInstructions?: HeliusInstruction[];
}

interface HeliusInnerInstructionGroup {
  index: number;
  instructions: HeliusInstruction[];
}

interface HeliusRawEvent {
  signature?: string;
  transactionError?: unknown;
  instructions?: HeliusInstruction[];
  innerInstructions?: HeliusInnerInstructionGroup[];
  transaction?: {
    signatures?: string[];
    message?: {
      instructions?: HeliusInstruction[];
    };
  };
}

// ── Exported for testing ──────────────────────────────────────────────────────

export { identifyInstruction, extractProgramInstructions, processHtlcEvent, tryAutoClaimOnLock };
export type { HeliusRawEvent, HeliusInstruction };
