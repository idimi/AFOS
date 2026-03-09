import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, peerReputation, PeerReputation, userSettings, UserSettings, DEFAULT_USER_SETTINGS, htlcSecrets, HtlcSecret, InsertHtlcSecret } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── User Settings Helpers ───────────────────────────────────────────────────

/**
 * Returns the stored settings for a user, or the defaults if no row exists yet.
 * Never throws — callers can safely use the returned object without null checks.
 */
export type UserSettingsResult = {
  id?: number;
  maxTxAmountUsd: number;
  autoConfirm: boolean;
  slippagePct: string;
  preferredRoute: "intercomswap" | "jupiter" | "zerox" | "oneinch" | "best";
  theme: "dark" | "light" | "system";
  autoAcceptRfq: boolean;
  autoAcceptMaxUsd: number;
};

export async function getUserSettings(openId: string): Promise<UserSettingsResult> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_USER_SETTINGS };

  try {
    const rows = await db.select().from(userSettings).where(eq(userSettings.openId, openId)).limit(1);
    if (rows.length === 0) return { ...DEFAULT_USER_SETTINGS };
    const row = rows[0];
    const r = row as Record<string, unknown>;
    return {
      id: row.id,
      maxTxAmountUsd: row.maxTxAmountUsd,
      autoConfirm: row.autoConfirm === 1,
      slippagePct: row.slippagePct,
      preferredRoute: row.preferredRoute,
      theme: row.theme,
      autoAcceptRfq: r.autoAcceptRfq === 1,
      autoAcceptMaxUsd: (r.autoAcceptMaxUsd as number) ?? 0,
    };
  } catch (err) {
    console.warn("[DB] getUserSettings failed, returning defaults:", err);
    return { ...DEFAULT_USER_SETTINGS };
  }
}

/**
 * Upsert user settings. Partial — only provided fields are updated.
 */
export async function upsertUserSettings(
  openId: string,
  patch: {
    maxTxAmountUsd?: number;
    autoConfirm?: boolean;
    slippagePct?: string;
    preferredRoute?: UserSettings["preferredRoute"];
    theme?: UserSettings["theme"];
    autoAcceptRfq?: boolean;
    autoAcceptMaxUsd?: number;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[DB] upsertUserSettings: database not available");
    return;
  }

  const insertValues = {
    openId,
    maxTxAmountUsd: patch.maxTxAmountUsd ?? DEFAULT_USER_SETTINGS.maxTxAmountUsd,
    autoConfirm: ((patch.autoConfirm ?? DEFAULT_USER_SETTINGS.autoConfirm) ? 1 : 0) as number,
    slippagePct: patch.slippagePct ?? DEFAULT_USER_SETTINGS.slippagePct,
    preferredRoute: (patch.preferredRoute ?? DEFAULT_USER_SETTINGS.preferredRoute) as UserSettings["preferredRoute"],
    theme: (patch.theme ?? DEFAULT_USER_SETTINGS.theme) as UserSettings["theme"],
    // Cast to number since Drizzle schema uses int for these boolean-like columns
    autoAcceptRfq: ((patch.autoAcceptRfq ?? DEFAULT_USER_SETTINGS.autoAcceptRfq) ? 1 : 0) as number,
    autoAcceptMaxUsd: (patch.autoAcceptMaxUsd ?? DEFAULT_USER_SETTINGS.autoAcceptMaxUsd) as number,
  };

  const updateSet: Record<string, unknown> = {};
  if (patch.maxTxAmountUsd !== undefined) updateSet.maxTxAmountUsd = patch.maxTxAmountUsd;
  if (patch.autoConfirm !== undefined) updateSet.autoConfirm = patch.autoConfirm ? 1 : 0;
  if (patch.slippagePct !== undefined) updateSet.slippagePct = patch.slippagePct;
  if (patch.preferredRoute !== undefined) updateSet.preferredRoute = patch.preferredRoute;
  if (patch.theme !== undefined) updateSet.theme = patch.theme;
  if (patch.autoAcceptRfq !== undefined) updateSet.autoAcceptRfq = patch.autoAcceptRfq ? 1 : 0;
  if (patch.autoAcceptMaxUsd !== undefined) updateSet.autoAcceptMaxUsd = patch.autoAcceptMaxUsd;

  await db.insert(userSettings).values(insertValues).onDuplicateKeyUpdate({ set: updateSet });
}

// TODO: add feature queries here as your schema grows.

// ─── Peer Reputation Helpers ──────────────────────────────────────────────────

/**
 * Compute a 0–100 reputation score from raw signals.
 *  - Uptime (ping success rate): 40 pts
 *  - Swap success count (capped at 30 swaps = full 40 pts): 40 pts
 *  - Latency bonus (< 200ms avg = full 20 pts, scales linearly to 0 at 2000ms): 20 pts
 */
function computeScore(r: {
  successfulPings: number;
  failedPings: number;
  successfulSwaps: number;
  totalLatencyMs: number;
}): number {
  const totalPings = r.successfulPings + r.failedPings;
  const uptimePct = totalPings > 0 ? r.successfulPings / totalPings : 0.5;
  const uptimePts = Math.round(uptimePct * 40);

  const swapPts = Math.min(r.successfulSwaps, 30) / 30 * 40;

  const avgLatency = r.successfulPings > 0 ? r.totalLatencyMs / r.successfulPings : 1000;
  const latencyPts = Math.max(0, Math.round((1 - Math.min(avgLatency, 2000) / 2000) * 20));

  return Math.round(uptimePts + swapPts + latencyPts);
}

/** Upsert a peer record and record a ping result */
export async function recordPeerPing(
  peerId: string,
  alias: string | undefined,
  origin: string,
  latencyMs: number | null,
): Promise<PeerReputation | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const success = latencyMs !== null;
  const existing = await db.select().from(peerReputation).where(eq(peerReputation.peerId, peerId)).limit(1);

  if (existing.length === 0) {
    // First time we see this peer — insert with initial values
    const row = {
      peerId,
      alias: alias ?? null,
      origin,
      successfulPings: success ? 1 : 0,
      failedPings: success ? 0 : 1,
      successfulSwaps: 0,
      totalLatencyMs: success && latencyMs ? latencyMs : 0,
      score: success ? 55 : 45,
      lastSeenAt: new Date(),
    };
    await db.insert(peerReputation).values(row);
    return { ...row, id: 0, firstSeenAt: new Date(), updatedAt: new Date() } as PeerReputation;
  }

  const r = existing[0];
  const updates: Partial<PeerReputation> = {
    successfulPings: r.successfulPings + (success ? 1 : 0),
    failedPings: r.failedPings + (success ? 0 : 1),
    totalLatencyMs: r.totalLatencyMs + (success && latencyMs ? latencyMs : 0),
    lastSeenAt: new Date(),
  };
  if (alias) updates.alias = alias;
  updates.score = computeScore({ ...r, ...updates } as typeof r);

  await db.update(peerReputation).set(updates).where(eq(peerReputation.peerId, peerId));
  return { ...r, ...updates } as PeerReputation;
}

/** Record a successful swap for a peer (increments successfulSwaps + updates score) */
export async function recordPeerSwap(peerId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select().from(peerReputation).where(eq(peerReputation.peerId, peerId)).limit(1);
  if (existing.length === 0) return; // Peer not yet tracked — skip

  const r = existing[0];
  const updates = {
    successfulSwaps: r.successfulSwaps + 1,
    lastSeenAt: new Date(),
    score: computeScore({ ...r, successfulSwaps: r.successfulSwaps + 1 }),
  };
  await db.update(peerReputation).set(updates).where(eq(peerReputation.peerId, peerId));
}

/** Get reputation for a list of peer IDs (returns map peerId → score) */
export async function getPeerReputations(peerIds: string[]): Promise<Map<string, PeerReputation>> {
  const db = await getDb();
  const map = new Map<string, PeerReputation>();
  if (!db || peerIds.length === 0) return map;

  const rows = await db.select().from(peerReputation)
    .where(sql`${peerReputation.peerId} IN (${sql.join(peerIds.map(id => sql`${id}`), sql`, `)})`);

  for (const row of rows) map.set(row.peerId, row);
  return map;
}

/** Get all peer reputations ordered by score descending */
export async function getAllPeerReputations(): Promise<PeerReputation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(peerReputation).orderBy(sql`score DESC`);
}

// ─── HTLC Secret Helpers ───────────────────────────────────────────────────────────────────────────────
// These helpers persist HTLC preimage secrets server-side so the reveal step
// can complete even after a page refresh. secretHex is NEVER sent to clients.

/** Persist a new HTLC secret when Agent A locks their funds */
export async function saveHtlcSecret(data: InsertHtlcSecret): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(htlcSecrets).values(data)
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
}

/** Retrieve the HTLC secret for a given rfqId (server-side only) */
export async function getHtlcSecret(rfqId: string): Promise<HtlcSecret | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(htlcSecrets).where(eq(htlcSecrets.rfqId, rfqId)).limit(1);
  return rows[0] ?? null;
}

/** Update the status of an HTLC secret (e.g. after reveal or completion) */
export async function updateHtlcSecretStatus(
  rfqId: string,
  status: HtlcSecret["status"],
  extra?: { lockTxId?: string; revealTxId?: string },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(htlcSecrets)
    .set({ status, ...extra, updatedAt: new Date() })
    .where(eq(htlcSecrets.rfqId, rfqId));
}

/** Get all active (locked/revealed) HTLC secrets for the monitor */
export async function getActiveHtlcSecrets(): Promise<HtlcSecret[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(htlcSecrets)
    .where(sql`${htlcSecrets.status} IN ('locked', 'revealed')`);
}

/** Get recently settled (completed/expired/refunded) HTLC secrets for the history panel */
export async function getSettledHtlcSecrets(limit = 50): Promise<HtlcSecret[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(htlcSecrets)
    .where(sql`${htlcSecrets.status} IN ('completed', 'expired', 'refunded')`)
    .orderBy(sql`${htlcSecrets.updatedAt} DESC`)
    .limit(limit);
}
