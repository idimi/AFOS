/**
 * Deep on-chain inspection of all pending/claimable HTLCs.
 * Reads raw account bytes and parses the full HTLC struct.
 *
 * Anchor HTLC struct layout (219 bytes total):
 *   [0..8]   discriminator
 *   [8..40]  htlcId (32 bytes, null-padded UTF8)
 *   [40..72] sender (32 bytes pubkey)
 *   [72..104] receiver (32 bytes pubkey)
 *   [104..136] secretHash (32 bytes)
 *   [136..144] timelock (i64 LE)
 *   [144..152] amount (u64 LE)
 *   [152..185] padding/other fields (33 bytes)
 *   [185]    status (u8): 0=active, 1=refunded, 2=claimed
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

async function getAccountRaw(pubkey) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
      params: [pubkey, { encoding: 'base64' }]
    })
  });
  const json = await res.json();
  const val = json.result?.value;
  if (!val) return null;
  return Buffer.from(val.data[0], 'base64');
}

const STATUS_NAMES = { 0: 'ACTIVE', 1: 'REFUNDED', 2: 'CLAIMED' };

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all non-completed HTLCs
const [rows] = await conn.execute(
  `SELECT id, htlcId, status, htlcAddress, lockTxId, refundTxId, amountHuman, chain
   FROM htlc_swaps WHERE chain = 'solana' ORDER BY id ASC`
);

console.log('\n=== Deep On-Chain HTLC Inspection ===\n');
const nowSec = Math.floor(Date.now() / 1000);

for (const r of rows) {
  const raw = await getAccountRaw(r.htlcAddress);
  
  if (!raw) {
    console.log(`ID ${r.id} | PDA ${r.htlcAddress.slice(0,12)}... | ACCOUNT CLOSED (null)`);
    console.log(`  DB status: ${r.status} | amountHuman: ${r.amountHuman}`);
    console.log(`  → Funds gone (PDA closed). DB status '${r.status}' is ${r.status === 'refunded' || r.status === 'completed' ? 'CORRECT' : 'WRONG — should be refunded'}`);
    console.log();
    continue;
  }

  const len = raw.length;
  
  if (len < 186) {
    console.log(`ID ${r.id} | PDA ${r.htlcAddress.slice(0,12)}... | ACCOUNT EXISTS but too short (${len} bytes) — not an HTLC`);
    console.log();
    continue;
  }

  // Parse struct
  const htlcIdRaw = raw.slice(8, 40);
  const nullIdx = htlcIdRaw.indexOf(0);
  const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString('utf8');
  
  const sender = raw.slice(40, 72).toString('hex');
  const receiver = raw.slice(72, 104).toString('hex');
  const secretHash = raw.slice(104, 136).toString('hex');
  const timelock = Number(raw.readBigInt64LE(136));
  const amountLamports = Number(raw.readBigUInt64LE(144));
  const statusByte = raw[185];
  const statusName = STATUS_NAMES[statusByte] ?? `UNKNOWN(${statusByte})`;
  
  // Also check bytes around offset 152 (old wrong offset) for comparison
  const statusAt152 = raw[152];
  
  const timelockExpired = timelock > 0 && timelock < nowSec;
  const amountSol = amountLamports / 1e9;
  
  // Full hex dump of bytes 144-190 for debugging
  const debugBytes = raw.slice(144, 190).toString('hex').match(/.{2}/g).join(' ');
  
  console.log(`ID ${r.id} | PDA ${r.htlcAddress.slice(0,12)}...`);
  console.log(`  htlcId: ${htlcId}`);
  console.log(`  amount: ${amountLamports} lamports (${amountSol.toFixed(6)} SOL)`);
  console.log(`  timelock: ${timelock} (${timelockExpired ? 'EXPIRED' : 'active'}, now=${nowSec})`);
  console.log(`  status byte @185: ${statusByte} = ${statusName}`);
  console.log(`  status byte @152: ${statusAt152} (old wrong offset)`);
  console.log(`  bytes[144..190]: ${debugBytes}`);
  console.log(`  DB status: ${r.status}`);
  
  const dbCorrect = (statusByte === 0 && r.status === 'pending') ||
                    (statusByte === 1 && r.status === 'refunded') ||
                    (statusByte === 2 && r.status === 'completed');
  
  if (!dbCorrect) {
    const correctStatus = statusByte === 0 ? 'pending' : statusByte === 1 ? 'refunded' : 'completed';
    console.log(`  ⚠️  DB MISMATCH: DB says '${r.status}' but on-chain says '${statusName}' → should be '${correctStatus}'`);
  } else {
    console.log(`  ✓ DB status matches on-chain`);
  }
  
  if (statusByte === 0 && timelockExpired) {
    console.log(`  → CLAIMABLE: timelock expired, funds still locked (${amountSol.toFixed(6)} SOL)`);
  } else if (statusByte === 0 && !timelockExpired) {
    console.log(`  → LOCKED: timelock not yet expired`);
  }
  console.log();
}

await conn.end();
console.log('Done.');
