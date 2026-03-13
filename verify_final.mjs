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
  return j.result;
}

const STATUS_NAMES = { 0: "active", 1: "refunded", 2: "claimed" };

const db = await createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute(
  `SELECT id, htlcId, htlcAddress, status, refundTxId FROM htlc_swaps WHERE chain = 'solana' ORDER BY id DESC LIMIT 20`
);

console.log("\n=== ON-CHAIN VERIFICATION (correct struct layout) ===\n");

for (const row of rows) {
  const addr = row.htlcAddress;
  if (!addr || addr === "undefined" || addr.length < 32) {
    console.log(`[ID ${row.id}] NO ADDRESS — DB: ${row.status}`);
    continue;
  }

  const info = await rpc("getAccountInfo", [addr, { encoding: "base64" }]);
  const val = info?.value;

  if (!val) {
    const ok = row.status === "refunded" || row.status === "claimed";
    console.log(`[ID ${row.id}] ${addr.slice(0,8)}... | DB: ${row.status} | On-chain: CLOSED | ${ok ? "✅ CORRECT" : "⚠️  DB WRONG"}`);
    continue;
  }

  const raw = Buffer.from(val.data[0], "base64");
  const lamports = val.lamports;

  // Fixed 32-byte htlcId at offset 8 (null-padded)
  const htlcIdRaw = raw.slice(8, 40);
  const nullIdx = htlcIdRaw.indexOf(0);
  const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString("utf8");

  // Amount at bytes 144-151 (u64 LE)
  const amount = raw.length >= 152 ? Number(raw.readBigUInt64LE(144)) : 0;

  // Status byte at 185 (confirmed from hex dump analysis)
  const statusByte = raw.length > 185 ? raw[185] : -1;
  const onChainStatus = STATUS_NAMES[statusByte] ?? `unknown(${statusByte})`;

  // Timelock at bytes 136-143 (i64 LE)
  const timelock = raw.length >= 144 ? Number(raw.readBigInt64LE(136)) : 0;
  const now = Math.floor(Date.now() / 1000);
  const expired = timelock > 0 && timelock < now;

  let verdict = "";
  if (statusByte === 1) {
    verdict = row.status === "refunded"
      ? "✅ CORRECT (on-chain: refunded, DB: refunded)"
      : `⚠️  DB WRONG — on-chain is refunded but DB says "${row.status}"`;
  } else if (statusByte === 2) {
    verdict = "✅ Claimed on-chain";
  } else if (statusByte === 0) {
    if (row.status === "refunded") {
      verdict = "🚨 INCORRECTLY MARKED — funds still ACTIVE on-chain! DB says refunded but it's NOT.";
    } else if (expired) {
      verdict = "⏰ Active, timelock EXPIRED — user can claim refund";
    } else {
      verdict = "🔒 Active, timelock not expired yet — normal";
    }
  }

  console.log(`[ID ${row.id}] ${addr.slice(0,8)}... | DB: ${row.status} | On-chain: ${onChainStatus} (statusByte=${statusByte}, ${lamports} lam, amount=${amount})`);
  console.log(`  htlcId: ${htlcId}`);
  console.log(`  timelock: ${timelock ? new Date(timelock*1000).toISOString() : "none"} | expired: ${expired}`);
  console.log(`  ${verdict}\n`);
}

await db.end();
