/**
 * Admin Audit Log Helper
 *
 * Provides `writeAuditLog` — a fire-and-forget helper that records every
 * admin configuration change to the `admin_audit_log` table.
 *
 * Usage:
 *   await writeAuditLog({
 *     userId:   ctx.user.id,
 *     userName: ctx.user.name,
 *     section:  "fee_config",
 *     changes:  diffObjects(before, after),
 *   });
 *
 * `diffObjects` returns only the fields that actually changed, so each
 * changed field gets its own row (makes querying and display much cleaner).
 */

import { getDb } from "../db";
import { adminAuditLog } from "../../drizzle/schema";

export type AuditSection = "fee_config" | "treasury" | "operator_config";

export interface AuditChange {
  fieldName: string;
  oldValue:  unknown;
  newValue:  unknown;
}

export interface WriteAuditLogInput {
  userId:   number | null;
  userName: string | null;
  section:  AuditSection;
  changes:  AuditChange[];
}

/**
 * Serialise a value for storage in the audit log.
 * Objects/arrays → JSON string; primitives → string representation.
 */
function serialise(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Diff two plain objects and return an array of { fieldName, oldValue, newValue }
 * for every key whose value changed.
 *
 * Only top-level keys are compared (shallow diff).
 * Keys present in `after` but not `before` are treated as new (oldValue = null).
 */
export function diffObjects(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  for (const key of allKeys) {
    const oldVal = before[key];
    const newVal = after[key];
    // Normalise for comparison: serialise both to avoid object reference issues
    if (serialise(oldVal) !== serialise(newVal)) {
      changes.push({ fieldName: key, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

/**
 * Write one row per changed field to the audit log.
 * Never throws — errors are logged to console so they don't break the save operation.
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  if (input.changes.length === 0) return;

  try {
    const db = await getDb();
    if (!db) return;

    const rows = input.changes.map(c => ({
      userId:    input.userId,
      userName:  input.userName,
      section:   input.section,
      fieldName: c.fieldName,
      oldValue:  serialise(c.oldValue),
      newValue:  serialise(c.newValue),
    }));

    await db.insert(adminAuditLog).values(rows);
  } catch (err) {
    console.error("[AuditLog] Failed to write audit log entries:", err);
  }
}
