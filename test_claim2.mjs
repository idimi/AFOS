/**
 * Test claim with additional token accounts to satisfy the program.
 * The program may require a recipient_token_account even for SOL claims.
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { createHash } from 'crypto';
import mysql from 'mysql2/promise';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

// Agent keypair
const keyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
let agentKeypair;
try {
  agentKeypair = Keypair.fromSecretKey(bs58.decode(keyStr));
} catch {
  agentKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyStr)));
}

const HTLC_ID = 'htlc_a_rfq_1773205346880_lp-3';
const RECIPIENT = 'AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk';
const PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bE');

// USDT mint (the toToken for this HTLC)
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Get preimage from DB
const dbConn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await dbConn.execute('SELECT secretHex FROM htlc_secrets WHERE rfqId LIKE ?', ['%1773205346880%']);
await dbConn.end();
const secretHex = rows[0].secretHex;
const secretBytes = Buffer.from(secretHex, 'hex');

// Derive HTLC PDA
function htlcIdToBytes(htlcId) {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

function deriveAta(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

const htlcIdBytes = htlcIdToBytes(HTLC_ID);
const [htlcPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('htlc'), htlcIdBytes],
  PROGRAM_ID
);

const recipient = new PublicKey(RECIPIENT);
const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);
const data = Buffer.alloc(8 + 32);
CLAIM_DISCRIMINATOR.copy(data, 0);
Buffer.from(secretBytes).copy(data, 8);

// Try different account combinations
const accountCombinations = [
  {
    name: 'SOL claim + USDT token accounts',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: deriveAta(htlcPda, USDT_MINT), isSigner: false, isWritable: true },
      { pubkey: deriveAta(recipient, USDT_MINT), isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'SOL claim + recipient ATA only',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: deriveAta(recipient, USDT_MINT), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'SOL claim + vault ATA + recipient ATA',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: deriveAta(htlcPda, USDT_MINT), isSigner: false, isWritable: true },
      { pubkey: deriveAta(recipient, USDT_MINT), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
];

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

for (const combo of accountCombinations) {
  console.log('\nTrying:', combo.name);
  const claimIx = new TransactionInstruction({ programId: PROGRAM_ID, keys: combo.keys, data });
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = agentKeypair.publicKey;
  tx.add(claimIx);
  
  try {
    const simResult = await conn.simulateTransaction(tx, [agentKeypair]);
    if (simResult.value.err) {
      console.log('  FAILED:', JSON.stringify(simResult.value.err));
      const errorLog = simResult.value.logs?.find(l => l.includes('Error'));
      if (errorLog) console.log('  Error log:', errorLog);
    } else {
      console.log('  SIMULATION PASSED ✓');
      console.log('  Logs:', simResult.value.logs?.join('\n  '));
      
      // Submit the real transaction
      console.log('\nSubmitting real claim transaction...');
      const realTx = new Transaction();
      const { blockhash: bh2, lastValidBlockHeight: lvbh2 } = await conn.getLatestBlockhash('confirmed');
      realTx.recentBlockhash = bh2;
      realTx.lastValidBlockHeight = lvbh2;
      realTx.feePayer = agentKeypair.publicKey;
      realTx.add(claimIx);
      
      const txSig = await sendAndConfirmTransaction(conn, realTx, [agentKeypair], { commitment: 'confirmed', maxRetries: 3 });
      console.log('CLAIM SUCCESS! Tx:', txSig);
      console.log('Solscan:', 'https://solscan.io/tx/' + txSig);
      break;
    }
  } catch (err) {
    console.log('  Error:', err.message);
  }
}
