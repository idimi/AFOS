/**
 * Helius Webhook Integration for AFOS HTLC Program
 *
 * Registers a Helius "enhanced transactions" webhook on the AFOS HTLC program
 * address so the server receives real-time notifications when a lock, claim, or
 * refund instruction executes on-chain — eliminating the need for constant polling.
 *
 * Webhook lifecycle:
 *  - On startup: calls `ensureHeliusWebhook()` which creates or updates the
 *    webhook to point at `POST /api/webhooks/helius-htlc` on the live domain.
 *  - On each event: `handleHeliusHtlcWebhook()` parses the payload, identifies
 *    the instruction type via Anchor discriminator, and updates the htlc_swaps
 *    DB record accordingly.
 *
 * Security: Helius sends an `authorization` header with the webhook secret.
 *   Set HELIUS_WEBHOOK_SECRET in env; if unset, signature check is skipped
 *   (acceptable for dev but should be set in production).
 */

import type { Express, Request, Response } from "express";
import { getDb } from "../db.js";
import { htlcSwaps } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
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

  const webhookUrl = `${appBaseUrl}/api/webhooks/helius-htlc`;
  const secret = process.env.HELIUS_WEBHOOK_SECRET ?? "";

  try {
    // 1. List existing webhooks
    const listRes = await fetch(`${HELIUS_WEBHOOKS_API}?api-key=${apiKey}`);
    if (!listRes.ok) {
      console.warn("[HeliusWebhook] Failed to list webhooks:", listRes.status, await listRes.text());
      return;
    }
    const existing: HeliusWebhook[] = await listRes.json();

    // 2. Find an existing webhook for our program
    const match = existing.find(w =>
      w.accountAddresses?.includes(AFOS_HTLC_PROGRAM_ID) ||
      w.webhookURL === webhookUrl
    );

    const body = {
      webhookURL: webhookUrl,
      transactionTypes: ["ANY"],
      accountAddresses: [AFOS_HTLC_PROGRAM_ID],
      webhookType: "rawDevnet" in {} ? "raw" : "raw", // always raw for custom programs
      authHeader: secret || undefined,
    };

    if (match) {
      // 3a. Update existing webhook if URL or addresses changed
      if (match.webhookURL === webhookUrl && match.accountAddresses?.includes(AFOS_HTLC_PROGRAM_ID)) {
        console.log(`[HeliusWebhook] Webhook already configured (id: ${match.webhookID}). No update needed.`);
        return;
      }
      const updateRes = await fetch(`${HELIUS_WEBHOOKS_API}/${match.webhookID}?api-key=${apiKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (updateRes.ok) {
        console.log(`[HeliusWebhook] Updated webhook ${match.webhookID} → ${webhookUrl}`);
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
        console.log(`[HeliusWebhook] Created webhook ${created.webhookID} → ${webhookUrl}`);
      } else {
        console.warn("[HeliusWebhook] Failed to create webhook:", createRes.status, await createRes.text());
      }
    }
  } catch (err) {
    console.error("[HeliusWebhook] Registration error:", err);
  }
}

// ── Express route handler ─────────────────────────────────────────────────────

/**
 * Registers `POST /api/webhooks/helius-htlc` on the Express app.
 * Must be called before Vite middleware so the route is not swallowed by the SPA.
 */
export function registerHeliusWebhookRoute(app: Express): void {
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
    console.log(`[HeliusWebhook] Skipping failed tx: ${sig}`);
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
      console.warn("[HeliusWebhook] No DB connection — cannot update HTLC status");
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
    }
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
