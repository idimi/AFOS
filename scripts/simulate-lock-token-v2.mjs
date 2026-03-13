/**
 * Refined simulation — testing layouts near Layout 3 which got closest.
 * Layout 3 result: ConstraintMut on vault_token_account
 * This means htlcPda is at [1], senderAta at [2], vaultAta at [3]
 * But vaultAta needs to be writable — let's also try adding ASSOCIATED_TOKEN_PROGRAM
 * for init_if_needed support.
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

console.log('htlcPda:   ', htlcPda.toBase58());
console.log('senderAta: ', senderAta.toBase58());
console.log('vaultAta:  ', vaultAta.toBase58());
console.log('');

// Layout 3 was: sender, htlcPda, senderAta, vaultAta, tokenMint, tokenProg, sysProg
// Error: ConstraintMut on vault_token_account
// The vault ATA doesn't exist yet — it needs to be initialized (init_if_needed)
// Anchor's init_if_needed requires the ASSOCIATED_TOKEN_PROGRAM and the mint to be present

const accountLayouts = [
  {
    name: 'L3a: sender, htlcPda, senderAta, vaultAta(w), tokenMint, tokenProg, sysProg',
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
    name: 'L3b: sender, htlcPda, senderAta, vaultAta(w), tokenMint, tokenProg, sysProg, assocTokenProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'L3c: sender, htlcPda, senderAta, vaultAta(w), sysProg, tokenProg, tokenMint',
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
    name: 'L3d: sender, htlcPda, senderAta, vaultAta(w), sysProg, tokenProg, tokenMint, assocTokenProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: SPL_ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'L3e: sender, htlcPda, senderAta, vaultAta(w), tokenMint(w), tokenProg, sysProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'L3f: sender, htlcPda, senderAta, vaultAta(w), tokenMint, assocTokenProg, tokenProg, sysProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: SPL_ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]
  },
  {
    name: 'L3g: sender, htlcPda, tokenMint, senderAta, vaultAta(w), tokenProg, sysProg (original but vaultAta writable)',
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
    name: 'L3h: sender, htlcPda, tokenMint, senderAta, vaultAta(w), tokenProg, sysProg, assocTokenProg',
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: htlcPda, isSigner: false, isWritable: true },
      { pubkey: USDT_MINT, isSigner: false, isWritable: false },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
    const errorLog = logs.find(l => l.includes('Error') || l.includes('error') || l.includes('failed'));
    
    if (!err) {
      console.log(`✅ SUCCESS: ${layout.name}`);
      console.log('   Logs:', logs.slice(-5).join('\n   '));
    } else {
      const errStr = JSON.stringify(err);
      const anchorErr = logs.find(l => l.includes('AnchorError') || l.includes('Error Code'));
      if (errStr.includes('InvalidAccountData')) {
        console.log(`❌ InvalidAccountData: ${layout.name}`);
      } else if (anchorErr) {
        const code = anchorErr.match(/Error Code: (\w+)/)?.[1] ?? 'unknown';
        const acct = anchorErr.match(/account: (\w+)/)?.[1] ?? 'unknown';
        console.log(`⚠️  AnchorError(${code}) on account '${acct}': ${layout.name}`);
      } else {
        console.log(`❓ ${errStr}: ${layout.name}`);
        if (errorLog) console.log(`   Log: ${errorLog}`);
      }
    }
  } catch (e) {
    console.log(`💥 Exception: ${layout.name}: ${e.message}`);
  }
}
