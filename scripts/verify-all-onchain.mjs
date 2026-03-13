/**
 * Comprehensive on-chain verification of ALL Solana HTLCs.
 * For each HTLC in the DB, checks:
 *   1. Does the PDA exist on-chain?
 *   2. If yes: what is the lamport balance? What is the status byte @185?
 *   3. Compares DB status vs on-chain reality
 *   4. Reports which HTLCs still have funds locked
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';
dotenv.config({ path: '.env' });

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

const STATUS_NAMES = { 0: 'ACTIVE', 1: 'REFUNDED', 2: 'CLAIMED' };

async function rpcCall(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

async function getAccountInfo(pubkey) {
  const result = await rpcCall('getAccountInfo', [pubkey, { encoding: 'base64' }]);
  if (!result?.value) return null;
  return {
    data: Buffer.from(result.value.data[0], 'base64'),
    lamports: result.value.lamports,
    owner: result.value.owner,
  };
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get ALL Solana HTLCs
const [rows] = await conn.execute(
  `SELECT id, htlcAddress, htlcId, status, refundTxId, senderAddress, amountHuman, locktime
   FROM htlc_swaps
   WHERE chain = 'solana'
   ORDER BY id ASC`
);

console.log(`\n${'='.repeat(120)}`);
console.log(`  COMPREHENSIVE ON-CHAIN VERIFICATION — ${rows.length} Solana HTLCs`);
console.log(`${'='.repeat(120)}\n`);

const results = [];

for (const row of rows) {
  const acct = await getAccountInfo(row.htlcAddress);
  
  let onChainState;
  let statusByte = null;
  let lamports = 0;
  let solBalance = 0;
  let fundsLocked = false;

  if (!acct) {
    onChainState = 'CLOSED (PDA does not exist)';
  } else {
    lamports = acct.lamports;
    solBalance = lamports / 1e9;
    
    if (acct.data.length >= 186) {
      statusByte = acct.data[185];
      const statusName = STATUS_NAMES[statusByte] ?? `UNKNOWN(${statusByte})`;
      
      if (statusByte === 0) {
        onChainState = `ACTIVE — ${solBalance} SOL locked (status=0)`;
        fundsLocked = true;
      } else if (statusByte === 1) {
        onChainState = `REFUNDED on-chain (status=1, ${solBalance} SOL rent remains)`;
      } else if (statusByte === 2) {
        onChainState = `CLAIMED on-chain (status=2, ${solBalance} SOL rent remains)`;
      } else {
        onChainState = `${statusName} (${solBalance} SOL)`;
      }
    } else {
      onChainState = `PDA exists but data too short (${acct.data.length} bytes, ${solBalance} SOL)`;
    }
  }

  const dbStatusMatch = (() => {
    if (!acct && (row.status === 'refunded' || row.status === 'claimed')) return '✅ MATCH';
    if (acct && statusByte === 0 && row.status === 'pending') return '✅ MATCH';
    if (acct && statusByte === 1 && row.status === 'refunded') return '✅ MATCH';
    if (acct && statusByte === 2 && row.status === 'claimed') return '✅ MATCH';
    if (acct && statusByte === 0 && row.status === 'refunded') return '🔴 MISMATCH — DB says refunded but on-chain is ACTIVE';
    if (acct && statusByte === 0 && row.status === 'expired') return '🔴 MISMATCH — DB says expired but on-chain is ACTIVE';
    if (acct && statusByte === 1 && row.status === 'pending') return '⚠️ MISMATCH — DB says pending but on-chain is REFUNDED';
    if (acct && statusByte === 2 && row.status === 'pending') return '⚠️ MISMATCH — DB says pending but on-chain is CLAIMED';
    if (!acct && row.status === 'pending') return '⚠️ MISMATCH — DB says pending but PDA is closed';
    return '❓ UNCLEAR';
  })();

  const isRefundTxFake = row.refundTxId && (
    row.refundTxId.includes('auto-detected') ||
    row.refundTxId.includes('already-settled') ||
    row.refundTxId.length < 40
  );

  results.push({
    id: row.id,
    pda: row.htlcAddress,
    dbStatus: row.status,
    onChainState,
    statusByte,
    lamports,
    solBalance,
    fundsLocked,
    dbStatusMatch,
    refundTxId: row.refundTxId,
    isRefundTxFake,
    amountHuman: row.amountHuman,
    senderAddress: row.senderAddress,
  });

  console.log(`ID ${String(row.id).padStart(2)} | PDA: ${row.htlcAddress.slice(0,12)}… | DB: ${row.status.padEnd(10)} | On-chain: ${onChainState}`);
  console.log(`       ${dbStatusMatch}`);
  if (isRefundTxFake) console.log(`       ⚠️  refundTxId is FAKE: "${row.refundTxId}"`);
  if (fundsLocked) console.log(`       🔴 FUNDS STILL LOCKED: ${row.amountHuman} (${solBalance} SOL on-chain)`);
  console.log('');
}

// Summary
console.log(`${'='.repeat(120)}`);
console.log('  SUMMARY');
console.log(`${'='.repeat(120)}`);

const locked = results.filter(r => r.fundsLocked);
const mismatched = results.filter(r => r.dbStatusMatch.includes('MISMATCH'));
const fakeRefundTx = results.filter(r => r.isRefundTxFake);

console.log(`\n  Total HTLCs: ${results.length}`);
console.log(`  Funds still locked on-chain: ${locked.length}`);
if (locked.length > 0) {
  console.log(`\n  🔴 HTLCs WITH FUNDS STILL LOCKED:`);
  for (const r of locked) {
    console.log(`     ID ${r.id} | PDA: ${r.pda} | ${r.solBalance} SOL | DB status: ${r.dbStatus} | sender: ${r.senderAddress?.slice(0,12)}…`);
  }
}

console.log(`\n  DB/on-chain mismatches: ${mismatched.length}`);
if (mismatched.length > 0) {
  for (const r of mismatched) {
    console.log(`     ID ${r.id} | ${r.dbStatusMatch}`);
  }
}

console.log(`\n  Fake refundTxId entries: ${fakeRefundTx.length}`);
if (fakeRefundTx.length > 0) {
  for (const r of fakeRefundTx) {
    console.log(`     ID ${r.id} | "${r.refundTxId}"`);
  }
}

const totalLockedSol = locked.reduce((sum, r) => sum + r.solBalance, 0);
console.log(`\n  Total SOL still locked: ${totalLockedSol} SOL`);

await conn.end();
console.log('\nDone.');
