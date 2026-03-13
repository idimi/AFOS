/**
 * Check on-chain state of the stuck swap (rfq_1773375728714)
 * HTLC A (ID 13): Agent A's SOL lock — gDGWLWBZ... wait, ID 13 is rfq_1773375728714
 * HTLC A (ID 13): htlcAddress = 7n2BWJUeAdspNPrAQ4CsjfsAzC5giX4k9N89rUGQuHZn (Agent A SOL lock)
 * HTLC B (ID 14): htlcAddress = F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9 (Agent B USDT lock)
 */
import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

const htlcs = [
  { id: 13, name: 'HTLC A (Agent A SOL lock)', pda: '7n2BWJUeAdspNPrAQ4CsjfsAzC5giX4k9N89rUGQuHZn', lockTx: '227ALQWPisaGFfozpKe92BEZ6kitX9TXrzMKERYmikj1m7LPBWF2CK5p3XaWjfuCoxS6aUVPWxtXWobUkhuj4f3b' },
  { id: 14, name: 'HTLC B (Agent B USDT lock)', pda: 'F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9', lockTx: '2c6Gqkh9K3xK9qgaSEc1rKbUSpM9z2Wd2tqoEwnpkqs5pMHG2ndJWTirrgiJPtBNFcCYR2UmTDVXgMpbKH69y1MX' },
];

const STATUS_NAMES = { 0: 'ACTIVE', 1: 'REFUNDED', 2: 'CLAIMED' };
const STATUS_OFFSET = 185;

for (const h of htlcs) {
  console.log(`\n=== ${h.name} ===`);
  console.log(`PDA: ${h.pda}`);
  
  const info = await conn.getAccountInfo(new PublicKey(h.pda));
  if (!info) {
    console.log('Status: CLOSED (account does not exist)');
    continue;
  }
  
  const lamports = info.lamports;
  const data = info.data;
  console.log(`Lamports: ${lamports} (${(lamports / 1e9).toFixed(9)} SOL)`);
  console.log(`Data length: ${data.length} bytes`);
  
  if (data.length > STATUS_OFFSET) {
    const statusByte = data[STATUS_OFFSET];
    console.log(`Status byte @${STATUS_OFFSET}: ${statusByte} = ${STATUS_NAMES[statusByte] ?? 'UNKNOWN'}`);
  }
  
  // Check the lock tx
  console.log(`\nLock tx: ${h.lockTx.slice(0, 20)}...`);
  try {
    const tx = await conn.getTransaction(h.lockTx, { maxSupportedTransactionVersion: 0 });
    if (tx) {
      console.log(`Lock tx result: ${tx.meta?.err ? 'FAILED: ' + JSON.stringify(tx.meta.err) : 'SUCCESS'}`);
    } else {
      console.log('Lock tx: not found');
    }
  } catch (e) {
    console.log(`Lock tx error: ${e.message}`);
  }
}

// Also check the reveal endpoint
console.log('\n=== Checking reveal endpoint ===');
const ORACLE_URL = process.env.ORACLE_API_URL;
console.log('ORACLE_API_URL:', ORACLE_URL || '(not set)');

// Check the latest server logs for the reveal attempt
import { readFileSync } from 'fs';
try {
  const logs = readFileSync('/home/ubuntu/afos-dashboard/.manus-logs/devserver.log', 'utf8');
  const lines = logs.split('\n');
  const revealLines = lines.filter(l => l.includes('reveal') || l.includes('Reveal') || l.includes('502') || l.includes('Bad Gateway') || l.includes('rfq_1773375728714'));
  console.log('\nRelevant log lines:');
  revealLines.slice(-30).forEach(l => console.log(l));
} catch (e) {
  console.log('Could not read logs:', e.message);
}
