/**
 * Deep on-chain verification of all Solana HTLCs in the DB.
 * Uses the correct Anchor String layout:
 *   discriminator(8) + htlcId_string(4+N) + sender(32) + receiver(32) + secretHash(32) + timelock(8) + amount(8) + status(1)
 * where N is the actual string length stored as u32 LE prefix.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const RPC = "http://localhost:3000/api/sol-rpc";

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

function parseHtlcStruct(data) {
  // Anchor String layout: 4-byte LE length prefix + N bytes UTF-8
  if (data.length < 12) return null;
  const strLen = data.readUInt32LE(8); // bytes 8-11 = string length
  if (strLen > 200 || 8 + 4 + strLen + 32 + 32 + 32 + 8 + 8 + 1 > data.length) return null;
  
  const offset = 8 + 4 + strLen; // after discriminator + string length + string bytes
  const htlcId = data.slice(12, 12 + strLen).toString("utf8");
  
  if (offset + 32 + 32 + 32 + 8 + 8 + 1 > data.length) return null;
  
  const sender = Buffer.from(data.slice(offset, offset + 32)).toString("hex");
  // secretHash at offset+64
  const secretHash = Buffer.from(data.slice(offset + 64, offset + 96)).toString("hex");
  // timelock at offset+96 (i64 LE)
  const timelock = Number(data.readBigInt64LE(offset + 96));
  // amount at offset+104 (u64 LE)
  const amount = Number(data.readBigUInt64LE(offset + 104));
  // status at offset+112
  const statusByte = data[offset + 112];
  
  return { htlcId, strLen, offset, timelock, amount, statusByte };
}

const db = await createConnection(process.env.DATABASE_URL);

const [rows] = await db.execute(
  `SELECT id, htlcId, htlcAddress, lockTxId, refundTxId, status, senderAddress, amountHuman, rfqId
   FROM htlc_swaps
   WHERE chain = 'solana'
   ORDER BY id DESC
   LIMIT 30`
);

console.log(`\n${"=".repeat(80)}`);
console.log(`ON-CHAIN VERIFICATION — ${rows.length} Solana HTLCs`);
console.log(`${"=".repeat(80)}\n`);

const issues = [];

for (const row of rows) {
  const addr = row.htlcAddress;
  if (!addr || addr === "undefined" || addr.length < 32) {
    console.log(`[ID ${row.id}] NO ADDRESS — DB status: ${row.status}`);
    continue;
  }

  let accInfo;
  try {
    accInfo = await rpc("getAccountInfo", [addr, { encoding: "base64" }]);
  } catch (e) {
    console.log(`[ID ${row.id}] ${addr.slice(0,8)}... RPC ERROR: ${e.message}`);
    continue;
  }

  const val = accInfo?.value;
  const lamports = val?.lamports ?? 0;
  const exists = val !== null && val !== undefined;

  if (!exists) {
    // PDA closed
    const ok = row.status === "refunded" || row.status === "claimed";
    const mark = ok ? "✅" : "⚠️ ";
    console.log(`[ID ${row.id}] ${addr.slice(0,8)}... | DB: ${row.status} | On-chain: CLOSED (PDA deleted)`);
    console.log(`  ${mark} PDA is closed — funds fully returned. DB status "${row.status}" is ${ok ? "correct" : "WRONG — should be refunded"}\n`);
    if (!ok) issues.push({ id: row.id, addr, issue: "PDA closed but DB not refunded", fix: "mark refunded" });
    continue;
  }

  // PDA exists — parse the struct
  const rawB64 = val.data[0];
  const raw = Buffer.from(rawB64, "base64");
  const parsed = parseHtlcStruct(raw);

  const now = Math.floor(Date.now() / 1000);
  const timelockExpired = parsed ? parsed.timelock > 0 && parsed.timelock < now : null;

  const statusNames = { 0: "active", 1: "refunded", 2: "claimed" };
  const onChainStatusName = parsed ? (statusNames[parsed.statusByte] ?? `unknown(${parsed.statusByte})`) : "parse-failed";

  // Determine verdict
  let verdict = "";
  let issue = null;

  if (!parsed) {
    verdict = "⚠️  Could not parse struct — raw data may have different layout";
    issue = "parse-failed";
  } else if (parsed.statusByte === 1) {
    // On-chain says refunded
    if (row.status === "refunded") {
      verdict = "✅ On-chain: refunded. DB: refunded. CORRECT.";
    } else {
      verdict = `⚠️  On-chain: refunded but DB says "${row.status}" — DB needs update`;
      issue = "on-chain refunded but DB wrong";
      issues.push({ id: row.id, addr, issue, fix: "mark refunded" });
    }
  } else if (parsed.statusByte === 2) {
    // On-chain says claimed
    if (row.status === "refunded" || row.status === "claimed") {
      verdict = "✅ On-chain: claimed. DB status acceptable.";
    } else {
      verdict = `⚠️  On-chain: claimed but DB says "${row.status}" — DB needs update`;
      issue = "on-chain claimed but DB wrong";
      issues.push({ id: row.id, addr, issue, fix: "mark refunded" });
    }
  } else if (parsed.statusByte === 0) {
    // On-chain says active
    if (row.status === "refunded") {
      // Check if actual lamports match what was locked
      const rentOnly = lamports <= 2_500_000; // ~2.4M is typical rent for this PDA size
      if (rentOnly) {
        verdict = `⚠️  On-chain: ACTIVE status byte=0, but PDA balance is rent-only (${lamports} lam). Funds may have been withdrawn via a different mechanism. DB says "refunded" — INVESTIGATE.`;
        issue = "active status byte but balance is rent-only, DB says refunded";
        issues.push({ id: row.id, addr, issue, fix: "investigate — could be incorrectly marked" });
      } else {
        verdict = `🚨 FUNDS STILL LOCKED — On-chain: active (${lamports} lam = ${(lamports/1e9).toFixed(4)} SOL), DB says "refunded" — INCORRECTLY MARKED!`;
        issue = "funds still locked but DB says refunded";
        issues.push({ id: row.id, addr, issue, fix: "revert to pending — funds still locked" });
      }
    } else if (row.status === "pending" || row.status === "locked") {
      if (timelockExpired) {
        verdict = `⏰ On-chain: active, timelock EXPIRED (${new Date(parsed.timelock * 1000).toISOString()}). DB: ${row.status}. User can claim refund.`;
      } else {
        verdict = `🔒 On-chain: active, timelock NOT expired yet (${new Date(parsed.timelock * 1000).toISOString()}). DB: ${row.status}. Normal.`;
      }
    } else {
      verdict = `ℹ️  On-chain: active. DB: ${row.status}.`;
    }
  }

  console.log(`[ID ${row.id}] ${addr.slice(0,8)}... | DB: ${row.status} | On-chain: ${onChainStatusName} (${lamports} lam)`);
  if (parsed) {
    console.log(`  htlcId: ${parsed.htlcId}`);
    console.log(`  amount: ${parsed.amount} lam (${(parsed.amount/1e9).toFixed(4)} SOL) | timelock: ${parsed.timelock ? new Date(parsed.timelock*1000).toISOString() : "none"} | expired: ${timelockExpired}`);
  }
  console.log(`  ${verdict}\n`);
}

console.log(`${"=".repeat(80)}`);
console.log(`SUMMARY: ${issues.length} issues found`);
for (const issue of issues) {
  console.log(`  [ID ${issue.id}] ${issue.addr.slice(0,8)}... — ${issue.issue} → FIX: ${issue.fix}`);
}
console.log(`${"=".repeat(80)}\n`);

await db.end();
