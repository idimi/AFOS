/**
 * Systematically try different account orderings for the HTLC claim instruction.
 * The program logs tell us exactly which account is failing.
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import mysql from 'mysql2/promise';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

const keyStr = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
let agentKeypair;
try { agentKeypair = Keypair.fromSecretKey(bs58.decode(keyStr)); }
catch { agentKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyStr))); }

const HTLC_ID = 'htlc_a_rfq_1773205346880_lp-3';
const RECIPIENT = 'AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk';
const PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bE');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

const dbConn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await dbConn.execute('SELECT secretHex FROM htlc_secrets WHERE rfqId LIKE ?', ['%1773205346880%']);
await dbConn.end();
const secretBytes = Buffer.from(rows[0].secretHex, 'hex');

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
const [htlcPda] = PublicKey.findProgramAddressSync([Buffer.from('htlc'), htlcIdBytes], PROGRAM_ID);
const recipient = new PublicKey(RECIPIENT);
const vaultAta = deriveAta(htlcPda, USDT_MINT);
const recipientAta = deriveAta(recipient, USDT_MINT);

console.log('htlcPda:', htlcPda.toBase58());
console.log('vaultAta:', vaultAta.toBase58());
console.log('recipientAta:', recipientAta.toBase58());

const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);
const data = Buffer.alloc(8 + 32);
CLAIM_DISCRIMINATOR.copy(data, 0);
Buffer.from(secretBytes).copy(data, 8);

// The program error sequence tells us the expected account order.
// Error 1: recipient_token_account missing (after SystemProgram)
// Error 2: token_program missing (after recipient_token_account)
// Error 3: system_program in wrong position
//
// Expected order for SOL claim (based on Anchor account struct):
// caller (signer), htlc (PDA), recipient, system_program
// But the program also has token accounts in the struct...
// Let's try: caller, htlc, recipient, vault_ata, recipient_ata, token_program, system_program

const accountCombinations = [
  {
    name: 'caller, htlc, recipient, vault_ata, recipient_ata, token_program, system_program',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'caller, htlc, recipient, system_program, vault_ata, recipient_ata, token_program',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'caller, htlc, recipient, system_program, mint, vault_ata, recipient_ata, token_program',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'caller, htlc, recipient, recipient_ata, system_program, token_program',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'caller, htlc, recipient, recipient_ata, vault_ata, system_program, token_program',
    keys: [
      { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
      const errorLog = simResult.value.logs?.find(l => l.includes('Error') || l.includes('error'));
      console.log('  FAILED:', JSON.stringify(simResult.value.err));
      if (errorLog) console.log('  Error:', errorLog);
    } else {
      console.log('  SIMULATION PASSED ✓');
      console.log('  Logs:', simResult.value.logs?.join('\n  '));
      
      // Submit real transaction
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
      process.exit(0);
    }
  } catch (err) {
    console.log('  Error:', err.message);
  }
}
