/**
 * ownerNotifyPrefs.ts
 * Loads the platform owner's notification preferences from the DB and caches
 * them for 5 minutes. Used by server-side jobs and routers to gate notifyOwner
 * calls based on the owner's settings.
 */

import { getUserSettings } from "../db.js";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema.js";

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface NotifyPrefs {
  ownerNotifyHtlcLocked: boolean;
  ownerNotifySecretRevealed: boolean;
  ownerNotifyRfqSent: boolean;
  ownerNotifyMissedLock: boolean;
  ownerNotifySwapCompleted: boolean;
}

let cachedPrefs: NotifyPrefs | null = null;
let cachedAt = 0;

/** Returns the owner's notification preferences, cached for 5 minutes. */
export async function getOwnerNotifyPrefs(): Promise<NotifyPrefs> {
  const now = Date.now();
  if (cachedPrefs && now - cachedAt < CACHE_TTL_MS) {
    return cachedPrefs;
  }

  const ownerOpenId = process.env.OWNER_OPEN_ID;
  if (!ownerOpenId) {
    // No owner configured — use defaults
    return {
      ownerNotifyHtlcLocked: DEFAULT_USER_SETTINGS.ownerNotifyHtlcLocked,
      ownerNotifySecretRevealed: DEFAULT_USER_SETTINGS.ownerNotifySecretRevealed,
      ownerNotifyRfqSent: DEFAULT_USER_SETTINGS.ownerNotifyRfqSent,
      ownerNotifyMissedLock: DEFAULT_USER_SETTINGS.ownerNotifyMissedLock,
      ownerNotifySwapCompleted: DEFAULT_USER_SETTINGS.ownerNotifySwapCompleted,
    };
  }

  try {
    const settings = await getUserSettings(ownerOpenId);
    cachedPrefs = {
      ownerNotifyHtlcLocked: Boolean(settings.ownerNotifyHtlcLocked ?? DEFAULT_USER_SETTINGS.ownerNotifyHtlcLocked),
      ownerNotifySecretRevealed: Boolean(settings.ownerNotifySecretRevealed ?? DEFAULT_USER_SETTINGS.ownerNotifySecretRevealed),
      ownerNotifyRfqSent: Boolean(settings.ownerNotifyRfqSent ?? DEFAULT_USER_SETTINGS.ownerNotifyRfqSent),
      ownerNotifyMissedLock: Boolean(settings.ownerNotifyMissedLock ?? DEFAULT_USER_SETTINGS.ownerNotifyMissedLock),
      ownerNotifySwapCompleted: Boolean(settings.ownerNotifySwapCompleted ?? DEFAULT_USER_SETTINGS.ownerNotifySwapCompleted),
    };
    cachedAt = now;
    return cachedPrefs;
  } catch {
    // DB error — return defaults
    return {
      ownerNotifyHtlcLocked: DEFAULT_USER_SETTINGS.ownerNotifyHtlcLocked,
      ownerNotifySecretRevealed: DEFAULT_USER_SETTINGS.ownerNotifySecretRevealed,
      ownerNotifyRfqSent: DEFAULT_USER_SETTINGS.ownerNotifyRfqSent,
      ownerNotifyMissedLock: DEFAULT_USER_SETTINGS.ownerNotifyMissedLock,
      ownerNotifySwapCompleted: DEFAULT_USER_SETTINGS.ownerNotifySwapCompleted,
    };
  }
}

/** Invalidate the cache so the next call re-fetches from DB. */
export function invalidateOwnerNotifyPrefsCache(): void {
  cachedPrefs = null;
  cachedAt = 0;
}
