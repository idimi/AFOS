/**
 * Test script to claim the stuck HTLC using the preimage from the DB.
 * The claim instruction sends SOL to the recipient (user's wallet).
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { createHash } from 'crypto';
import mysql from 'mysql2/promise';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

// Agent keypair (current SOL_HTLC_KEY)
const keyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
let agentKeypair;
try {
  agentKeypair = Keypair.fromSecretKey(bs58.decode(keyStr));
} catch {
  agentKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyStr)));
}
console.log('Agent pubkey:', agentKeypair.publicKey.toBase58());

// HTLC details
const HTLC_ADDRESS = '45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ';
const HTLC_ID = 'htlc_a_rfq_1773205346880_lp-3';
const RECIPIENT = 'AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk';
const PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');

// Get preimage from DB
const dbConn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await dbConn.execute('SELECT secretHex FROM htlc_secrets WHERE rfqId LIKE ?', ['%1773205346880%']);
await dbConn.end();

if (!rows.length) {
  console.error('Preimage not found in DB!');
  process.exit(1);
}

const secretHex = rows[0].secretHex;
console.log('Preimage (first 16 chars):', secretHex.slice(0, 16) + '...');

// Verify preimage
const secretBytes = Buffer.from(secretHex, 'hex');
const computedHash = createHash('sha256').update(secretBytes).digest('hex');
const expectedHash = '5a6a54b18a34f72035ff750851a588b3afc1e2bbdd62759ff18a6438dc3b293e';
console.log('Hash verification:', computedHash === expectedHash ? 'PASS ✓' : 'FAIL ✗');

// Derive HTLC PDA
function htlcIdToBytes(htlcId) {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

const htlcIdBytes = htlcIdToBytes(HTLC_ID);
const [htlcPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('htlc'), htlcIdBytes],
  PROGRAM_ID
);
console.log('Derived PDA:', htlcPda.toBase58());
console.log('Expected PDA:', HTLC_ADDRESS);
console.log('PDA matches:', htlcPda.toBase58() === HTLC_ADDRESS ? 'YES ✓' : 'NO ✗');

// Build claim instruction
// Discriminator: SHA256("global:claim")[0..8] = [62, 198, 214, 193, 213, 159, 108, 210]
const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);
const data = Buffer.alloc(8 + 32);
CLAIM_DISCRIMINATOR.copy(data, 0);
Buffer.from(secretBytes).copy(data, 8);

const recipient = new PublicKey(RECIPIENT);
const keys = [
  { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
  { pubkey: htlcPda, isSigner: false, isWritable: true },
  { pubkey: recipient, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
];

const claimIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys,
  data,
});

// Check agent balance
const agentBalance = await conn.getBalance(agentKeypair.publicKey);
console.log('\nAgent balance:', agentBalance / 1e9, 'SOL');

// Check HTLC balance
const htlcBalance = await conn.getBalance(htlcPda);
console.log('HTLC PDA balance:', htlcBalance / 1e9, 'SOL');

// Check recipient balance before
const recipientBalanceBefore = await conn.getBalance(recipient);
console.log('Recipient balance before:', recipientBalanceBefore / 1e9, 'SOL');

// Simulate the transaction first
console.log('\nSimulating claim transaction...');
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
const tx = new Transaction();
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = agentKeypair.publicKey;
tx.add(claimIx);

try {
  const simResult = await conn.simulateTransaction(tx, [agentKeypair]);
  if (simResult.value.err) {
    console.error('Simulation FAILED:', JSON.stringify(simResult.value.err));
    console.log('Logs:', simResult.value.logs?.join('\n'));
  } else {
    console.log('Simulation PASSED ✓');
    console.log('Logs:', simResult.value.logs?.join('\n'));
    
    // Submit the real transaction
    console.log('\nSubmitting real claim transaction...');
    const txSig = await sendAndConfirmTransaction(conn, tx, [agentKeypair], { commitment: 'confirmed', maxRetries: 3 });
    console.log('CLAIM SUCCESS! Tx:', txSig);
    console.log('Solscan:', 'https://solscan.io/tx/' + txSig);
    
    // Check recipient balance after
    const recipientBalanceAfter = await conn.getBalance(recipient);
    console.log('Recipient balance after:', recipientBalanceAfter / 1e9, 'SOL');
    console.log('SOL received:', (recipientBalanceAfter - recipientBalanceBefore) / 1e9, 'SOL');
  }
} catch (err) {
  console.error('Error:', err.message);
  if (err.logs) console.log('Logs:', err.logs.join('\n'));
}
