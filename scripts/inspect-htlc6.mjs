/**
 * Deep inspection of HTLC ID 6 (PDA: 4gKNVtZ4dYHw...)
 * Decode all struct fields including sender/receiver pubkeys in base58
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';
dotenv.config({ path: '.env' });

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

// Base58 encoding
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(buf) {
  let num = BigInt('0x' + Buffer.from(buf).toString('hex'));
  const chars = [];
  while (num > 0n) {
    chars.push(ALPHABET[Number(num % 58n)]);
    num = num / 58n;
  }
  // Leading zeros
  for (const b of buf) {
    if (b === 0) chars.push('1');
    else break;
  }
  return chars.reverse().join('');
}

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
  return { data: Buffer.from(val.data[0], 'base64'), lamports: val.lamports, owner: val.owner };
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get HTLC ID 6 from DB
const [rows] = await conn.execute(
  `SELECT * FROM htlc_swaps WHERE id = 6`
);
const dbRow = rows[0];
console.log('=== DB Record for HTLC ID 6 ===');
console.log(`  htlcAddress (PDA): ${dbRow.htlcAddress}`);
console.log(`  htlcId (seed): ${dbRow.htlcId}`);
console.log(`  status: ${dbRow.status}`);
console.log(`  senderAddress: ${dbRow.senderAddress}`);
console.log(`  receiverAddress: ${dbRow.receiverAddress}`);
console.log(`  amountHuman: ${dbRow.amountHuman}`);
console.log(`  lockTxId: ${dbRow.lockTxId}`);
console.log(`  refundTxId: ${dbRow.refundTxId}`);
console.log(`  chain: ${dbRow.chain}`);
console.log(`  secretHash: ${dbRow.secretHash}`);
console.log(`  locktime: ${dbRow.locktime}`);

// Get on-chain data
console.log('\n=== On-Chain Account Data ===');
const acct = await getAccountRaw(dbRow.htlcAddress);
if (!acct) {
  console.log('  ACCOUNT IS NULL (closed)');
  await conn.end();
  process.exit(0);
}

console.log(`  Lamports: ${acct.lamports} (${acct.lamports / 1e9} SOL)`);
console.log(`  Owner program: ${acct.owner}`);
console.log(`  Data length: ${acct.data.length} bytes`);

const raw = acct.data;

// Parse struct
const discriminator = raw.slice(0, 8).toString('hex');
const htlcIdRaw = raw.slice(8, 40);
const nullIdx = htlcIdRaw.indexOf(0);
const htlcId = htlcIdRaw.slice(0, nullIdx >= 0 ? nullIdx : 32).toString('utf8');
const senderPubkey = toBase58(raw.slice(40, 72));
const receiverPubkey = toBase58(raw.slice(72, 104));
const secretHash = raw.slice(104, 136).toString('hex');
const timelock = Number(raw.readBigInt64LE(136));
const amountLamports = Number(raw.readBigUInt64LE(144));

// Check various possible status byte offsets
console.log('\n=== Parsed HTLC Struct ===');
console.log(`  discriminator: ${discriminator}`);
console.log(`  htlcId: "${htlcId}"`);
console.log(`  sender: ${senderPubkey}`);
console.log(`  receiver: ${receiverPubkey}`);
console.log(`  secretHash: ${secretHash}`);
console.log(`  timelock: ${timelock} (${new Date(timelock * 1000).toISOString()})`);
console.log(`  amount: ${amountLamports} lamports (${amountLamports / 1e9} SOL)`);

// Check status at multiple offsets to be sure
const STATUS_NAMES = { 0: 'ACTIVE', 1: 'REFUNDED', 2: 'CLAIMED' };
for (const offset of [152, 153, 176, 184, 185, 186, 187]) {
  if (offset < raw.length) {
    console.log(`  byte[${offset}]: ${raw[offset]} = ${STATUS_NAMES[raw[offset]] ?? 'unknown'}`);
  }
}

// Hex dump of bytes 144-end for full visibility
console.log('\n=== Hex dump bytes 144 to end ===');
const hex = raw.slice(144).toString('hex').match(/.{2}/g);
for (let i = 0; i < hex.length; i += 16) {
  const offset = 144 + i;
  const line = hex.slice(i, i + 16).join(' ');
  console.log(`  [${offset.toString().padStart(3)}] ${line}`);
}

// Now check: what does the Claim button code actually check?
console.log('\n=== Key Questions ===');
console.log(`  Is timelock expired? ${timelock < Math.floor(Date.now()/1000) ? 'YES' : 'NO'} (now=${Math.floor(Date.now()/1000)}, timelock=${timelock})`);
console.log(`  Status byte @185: ${raw[185]} = ${STATUS_NAMES[raw[185]] ?? 'unknown'}`);
console.log(`  DB sender matches on-chain sender? ${dbRow.senderAddress === senderPubkey ? 'YES' : 'NO'}`);
console.log(`    DB sender: ${dbRow.senderAddress}`);
console.log(`    On-chain sender: ${senderPubkey}`);

await conn.end();
console.log('\nDone.');
