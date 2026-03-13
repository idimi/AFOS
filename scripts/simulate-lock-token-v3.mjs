/**
 * v3 simulation — the ConstraintMut error means the vault ATA needs to exist.
 * Anchor's `init_if_needed` requires the account to be writable AND the
 * ASSOCIATED_TOKEN_PROGRAM to be present for ATA creation.
 * 
 * The key insight: ConstraintMut means Anchor is checking that the account
 * is writable but the account doesn't exist yet. With init_if_needed, Anchor
 * will create it — but it needs the right programs in the accounts list.
 * 
 * Let's try: pre-create the vault ATA first, then lock.
 * Also try: different positions for ASSOCIATED_TOKEN_PROGRAM.
 */
import {
  Connection, PublicKey, TransactionInstruction, Transaction,
  SystemProgram, ComputeBudgetProgram
} from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

const AFOS_HTLC_PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

const sender = new PublicKey('CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW');

const testHtlcId = 'htlc_b_test_simulate_12345';
const htlcIdBytes = new Uint8Array(32);
const encoded = new TextEncoder().encode(testHtlcId.slice(0, 32));
htlcIdBytes.set(encoded);
const [htlcPda] = PublicKey.findProgramAddressSync([Buffer.from('htlc'), htlcIdBytes], AFOS_HTLC_PROGRAM_ID);

function deriveAta(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}
const senderAta = deriveAta(sender, USDT_MINT);
const vaultAta = deriveAta(htlcPda, USDT_MINT);
// Also try canonical spl-token derivation
const vaultAtaCanonical = getAssociatedTokenAddressSync(USDT_MINT, htlcPda, true);

console.log('htlcPda:         ', htlcPda.toBase58());
console.log('senderAta:       ', senderAta.toBase58());
console.log('vaultAta:        ', vaultAta.toBase58());
console.log('vaultAta(canon): ', vaultAtaCanonical.toBase58());
console.log('Same?', vaultAta.toBase58() === vaultAtaCanonical.toBase58());
console.log('');

const DISCRIMINATOR_LOCK_TOKEN = Buffer.from([153, 150, 141, 190, 78, 115, 232, 80]);
const secretHash = new Uint8Array(32).fill(0xab);
const recipient = sender;
const timelock = Math.floor(Date.now() / 1000) + 3600;
const tokenAmount = BigInt(1000);

const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
DISCRIMINATOR_LOCK_TOKEN.copy(data, 0);
Buffer.from(htlcIdBytes).copy(data, 8);
Buffer.from(secretHash).copy(data, 40);
recipient.toBuffer().copy(data, 72);
data.writeBigInt64LE(BigInt(timelock), 104);
data.writeBigUInt64LE(tokenAmount, 112);

// Check if vault ATA exists on-chain
const vaultAtaInfo = await conn.getAccountInfo(vaultAta);
console.log('vault ATA exists on-chain:', vaultAtaInfo ? 'YES' : 'NO');

const { blockhash } = await conn.getLatestBlockhash();

// Strategy 1: Pre-create the vault ATA in the same tx, then lock
// The vault ATA needs to be created with htlcPda as owner
// We need to create it BEFORE the lock instruction
async function testLayout(name, keys) {
  const ix = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys,
    data,
  });
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender;
  
  const result = await conn.simulateTransaction(tx, undefined, true);
  const err = result.value.err;
  const logs = result.value.logs ?? [];
  const anchorErr = logs.find(l => l.includes('AnchorError') || l.includes('Error Code'));
  
  if (!err) {
    console.log(`✅ SUCCESS: ${name}`);
    console.log('   Logs:', logs.slice(-5).join('\n   '));
  } else {
    const errStr = JSON.stringify(err);
    if (errStr.includes('InvalidAccountData')) {
      console.log(`❌ InvalidAccountData: ${name}`);
    } else if (anchorErr) {
      const code = anchorErr.match(/Error Code: (\w+)/)?.[1] ?? 'unknown';
      const acct = anchorErr.match(/account: (\w+)/)?.[1] ?? 'unknown';
      console.log(`⚠️  AnchorError(${code}) on '${acct}': ${name}`);
    } else {
      const errorLog = logs.find(l => l.includes('Error') || l.includes('failed'));
      console.log(`❓ ${errStr}: ${name}`);
      if (errorLog) console.log(`   Log: ${errorLog}`);
    }
  }
}

// Strategy: pre-create vault ATA in same tx
async function testWithPreCreate(name, lockKeys) {
  const createVaultAtaIx = createAssociatedTokenAccountInstruction(
    sender,       // payer
    vaultAta,     // ATA address
    htlcPda,      // owner (PDA)
    USDT_MINT,    // mint
  );
  
  const lockIx = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys: lockKeys,
    data,
  });
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(createVaultAtaIx);
  tx.add(lockIx);
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender;
  
  const result = await conn.simulateTransaction(tx, undefined, true);
  const err = result.value.err;
  const logs = result.value.logs ?? [];
  const anchorErr = logs.find(l => l.includes('AnchorError') || l.includes('Error Code'));
  
  if (!err) {
    console.log(`✅ SUCCESS (with pre-create): ${name}`);
    console.log('   Logs:', logs.slice(-5).join('\n   '));
  } else {
    const errStr = JSON.stringify(err);
    if (errStr.includes('InvalidAccountData')) {
      console.log(`❌ InvalidAccountData (with pre-create): ${name}`);
    } else if (anchorErr) {
      const code = anchorErr.match(/Error Code: (\w+)/)?.[1] ?? 'unknown';
      const acct = anchorErr.match(/account: (\w+)/)?.[1] ?? 'unknown';
      console.log(`⚠️  AnchorError(${code}) on '${acct}' (with pre-create): ${name}`);
    } else {
      const errorLog = logs.find(l => l.includes('Error') || l.includes('failed'));
      console.log(`❓ ${errStr} (with pre-create): ${name}`);
      if (errorLog) console.log(`   Log: ${errorLog}`);
    }
  }
}

// Test L3a with pre-created vault ATA
await testWithPreCreate('L3a: sender, htlcPda, senderAta, vaultAta, tokenMint, tokenProg, sysProg', [
  { pubkey: sender, isSigner: true, isWritable: true },
  { pubkey: htlcPda, isSigner: false, isWritable: true },
  { pubkey: senderAta, isSigner: false, isWritable: true },
  { pubkey: vaultAta, isSigner: false, isWritable: true },
  { pubkey: USDT_MINT, isSigner: false, isWritable: false },
  { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
]);

// Test with pre-created vault ATA and different orders
await testWithPreCreate('L3b: sender, htlcPda, senderAta, vaultAta, tokenMint, tokenProg, sysProg, assocProg', [
  { pubkey: sender, isSigner: true, isWritable: true },
  { pubkey: htlcPda, isSigner: false, isWritable: true },
  { pubkey: senderAta, isSigner: false, isWritable: true },
  { pubkey: vaultAta, isSigner: false, isWritable: true },
  { pubkey: USDT_MINT, isSigner: false, isWritable: false },
  { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: SPL_ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
]);

// Test original order with pre-created vault ATA
await testWithPreCreate('Original: sender, htlcPda, tokenMint, senderAta, vaultAta, tokenProg, sysProg', [
  { pubkey: sender, isSigner: true, isWritable: true },
  { pubkey: htlcPda, isSigner: false, isWritable: true },
  { pubkey: USDT_MINT, isSigner: false, isWritable: false },
  { pubkey: senderAta, isSigner: false, isWritable: true },
  { pubkey: vaultAta, isSigner: false, isWritable: true },
  { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
]);

// Test with pre-created vault ATA and no tokenMint in keys
await testWithPreCreate('No-mint: sender, htlcPda, senderAta, vaultAta, tokenProg, sysProg', [
  { pubkey: sender, isSigner: true, isWritable: true },
  { pubkey: htlcPda, isSigner: false, isWritable: true },
  { pubkey: senderAta, isSigner: false, isWritable: true },
  { pubkey: vaultAta, isSigner: false, isWritable: true },
  { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
]);

// Test without pre-create but with ASSOCIATED_TOKEN_PROGRAM for init_if_needed
await testLayout('No-precreate + assocProg first: sender, htlcPda, senderAta, vaultAta, assocProg, tokenMint, tokenProg, sysProg', [
  { pubkey: sender, isSigner: true, isWritable: true },
  { pubkey: htlcPda, isSigner: false, isWritable: true },
  { pubkey: senderAta, isSigner: false, isWritable: true },
  { pubkey: vaultAta, isSigner: false, isWritable: true },
  { pubkey: SPL_ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: USDT_MINT, isSigner: false, isWritable: false },
  { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
]);
