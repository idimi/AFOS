/**
 * Simulate the lock_token instruction with different account orders
 * to find which layout the AFOS HTLC program actually accepts.
 * 
 * Uses simulateTransaction (no actual signing needed) to test account layouts.
 */
import {
  Connection, PublicKey, TransactionInstruction, Transaction,
  SystemProgram, ComputeBudgetProgram
} from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

const AFOS_HTLC_PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Use the actual sender from the failed tx
const sender = new PublicKey('CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW');

// Derive HTLC PDA for a test htlcId
const testHtlcId = 'htlc_b_test_simulate_12345';
const htlcIdBytes = new Uint8Array(32);
const encoded = new TextEncoder().encode(testHtlcId.slice(0, 32));
htlcIdBytes.set(encoded);
const [htlcPda] = PublicKey.findProgramAddressSync([Buffer.from('htlc'), htlcIdBytes], AFOS_HTLC_PROGRAM_ID);

// Derive ATAs
function deriveAta(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}
const senderAta = deriveAta(sender, USDT_MINT);
const vaultAta = deriveAta(htlcPda, USDT_MINT);

// Build instruction data
const DISCRIMINATOR_LOCK_TOKEN = Buffer.from([153, 150, 141, 190, 78, 115, 232, 80]);
const secretHash = new Uint8Array(32).fill(0xab); // dummy hash
const recipient = sender; // use sender as recipient for simulation
const timelock = Math.floor(Date.now() / 1000) + 3600;
const tokenAmount = BigInt(1000); // 0.001 USDT

const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
DISCRIMINATOR_LOCK_TOKEN.copy(data, 0);
Buffer.from(htlcIdBytes).copy(data, 8);
Buffer.from(secretHash).copy(data, 40);
recipient.toBuffer().copy(data, 72);
data.writeBigInt64LE(BigInt(timelock), 104);
data.writeBigUInt64LE(tokenAmount, 112);

console.log('=== Account Addresses ===');
console.log('sender:    ', sender.toBase58());
console.log('htlcPda:   ', htlcPda.toBase58());
console.log('senderAta: ', senderAta.toBase58());
console.log('vaultAta:  ', vaultAta.toBase58());
console.log('USDT mint: ', USDT_MINT.toBase58());
console.log('');

// Test different account orders
const accountLayouts = [
  {
    name: 'Current code order: sender, htlcPda, tokenMint, senderAta, vaultAta, tokenProg, sysProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'Layout 2: sender, senderAta, htlcPda, vaultAta, tokenMint, tokenProg, sysProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'Layout 3: sender, htlcPda, senderAta, vaultAta, tokenMint, tokenProg, sysProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'Layout 4: sender, senderAta, htlcPda, vaultAta, sysProg, tokenProg, tokenMint',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'Layout 5: sender, htlcPda, senderAta, vaultAta, sysProg, tokenProg, tokenMint',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'Layout 6: sender, senderAta, vaultAta, htlcPda, tokenMint, tokenProg, sysProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
];

const { blockhash } = await conn.getLatestBlockhash();

for (const layout of accountLayouts) {
  const ix = new TransactionInstruction({
    programId: AFOS_HTLC_PROGRAM_ID,
    keys: layout.keys,
    data,
  });
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender;
  
  try {
    const result = await conn.simulateTransaction(tx, undefined, true);
    const err = result.value.err;
    const logs = result.value.logs ?? [];
    const firstError = logs.find(l => l.includes('Error') || l.includes('error') || l.includes('failed'));
    
    if (!err) {
      console.log(`✅ ${layout.name}`);
    } else {
      const errStr = JSON.stringify(err);
      // Categorize the error
      if (errStr.includes('InvalidAccountData')) {
        console.log(`❌ InvalidAccountData: ${layout.name}`);
      } else if (errStr.includes('AccountNotFound') || errStr.includes('AccountDoesNotExist')) {
        console.log(`⚠️  AccountNotFound (closer!): ${layout.name}`);
        console.log(`   Error: ${errStr}`);
      } else if (errStr.includes('InsufficientFunds')) {
        console.log(`💰 InsufficientFunds (account order OK, just no funds): ${layout.name}`);
      } else {
        console.log(`❓ ${errStr}: ${layout.name}`);
        if (firstError) console.log(`   Log: ${firstError}`);
      }
    }
  } catch (e) {
    console.log(`💥 Exception: ${layout.name}: ${e.message}`);
  }
}
