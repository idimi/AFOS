/**
 * Final verification: simulate the exact transaction that the fixed buildLockTokenTx will produce.
 * Mirrors the new code: createAssociatedTokenAccountIdempotent + lockToken instruction.
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

// Use a fresh htlcId for this test
const testHtlcId = 'htlc_b_verify_fix_9999999';
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

console.log('=== Verifying Fixed buildLockTokenTx ===');
console.log('htlcPda:   ', htlcPda.toBase58());
console.log('senderAta: ', senderAta.toBase58());
console.log('vaultAta:  ', vaultAta.toBase58());
console.log('');

const DISCRIMINATOR_LOCK_TOKEN = Buffer.from([153, 150, 141, 190, 78, 115, 232, 80]);
const secretHash = new Uint8Array(32).fill(0xcd);
const recipient = sender;
const timelock = Math.floor(Date.now() / 1000) + 3600;
const tokenAmount = BigInt(895654); // 0.895654 USDT (6 decimals)

const lockData = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
DISCRIMINATOR_LOCK_TOKEN.copy(lockData, 0);
Buffer.from(htlcIdBytes).copy(lockData, 8);
Buffer.from(secretHash).copy(lockData, 40);
recipient.toBuffer().copy(lockData, 72);
lockData.writeBigInt64LE(BigInt(timelock), 104);
lockData.writeBigUInt64LE(tokenAmount, 112);

// Instruction 1: createAssociatedTokenAccountIdempotent (data = [1])
const createVaultAtaIx = new TransactionInstruction({
  programId: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  keys: [
    { pubkey: sender, isSigner: true, isWritable: true },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: htlcPda, isSigner: false, isWritable: false },
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([1]), // createAssociatedTokenAccountIdempotent
});

// Instruction 2: lockToken (original account order)
const lockTokenIx = new TransactionInstruction({
  programId: AFOS_HTLC_PROGRAM_ID,
  keys: [
    { pubkey: sender, isSigner: true, isWritable: true },
    { pubkey: htlcPda, isSigner: false, isWritable: true },
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    { pubkey: senderAta, isSigner: false, isWritable: true },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: lockData,
});

const { blockhash } = await conn.getLatestBlockhash();
const tx = new Transaction();
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
tx.add(createVaultAtaIx);
tx.add(lockTokenIx);
tx.recentBlockhash = blockhash;
tx.feePayer = sender;

const result = await conn.simulateTransaction(tx, undefined, true);
const err = result.value.err;
const logs = result.value.logs ?? [];

if (!err) {
  console.log('✅ SIMULATION SUCCESS — Fixed buildLockTokenTx works correctly!');
  console.log('Logs:');
  logs.forEach(l => console.log(' ', l));
} else {
  console.log('❌ SIMULATION FAILED:', JSON.stringify(err));
  console.log('Logs:');
  logs.forEach(l => console.log(' ', l));
}
