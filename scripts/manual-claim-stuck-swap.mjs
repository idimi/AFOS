/**
 * Manual claim for stuck swap rfq_1773375728714
 * 
 * HTLC A (ID 13): htlcId = htlc_a_rfq_1773375728714_lp-c
 *   - Agent A locked 0.01 SOL → should be claimed by Agent B (CzP3GvDs...)
 * HTLC B (ID 14): htlcId = htlc_b_rfq_1773375728714_lp-c
 *   - Agent B locked 0.892359 USDT → should be claimed by Agent A (AuSUBiVV...)
 * 
 * Secret: ea89f6a38b4ee4e465b197b70ec7656adca116e8120465fae725bfdfa919f4cf
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

const AFOS_HTLC_PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);

function deriveHtlcPda(htlcId) {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(htlcId.slice(0, 32)));
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('htlc'), bytes], AFOS_HTLC_PROGRAM_ID);
  return pda;
}

function deriveAta(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// Load agent keypair
const agentKeypair = Keypair.fromSecretKey(bs58.decode(process.env.SOL_HTLC_KEY));
console.log('Agent keypair:', agentKeypair.publicKey.toBase58());

const secretHex = 'ea89f6a38b4ee4e465b197b70ec7656adca116e8120465fae725bfdfa919f4cf';
const preimage = hexToBytes(secretHex);

// ── Claim A: Release Agent A's 0.01 SOL → Agent B (CzP3GvDs) ──────────────
console.log('\n=== Claiming HTLC A (SOL → Agent B) ===');
const htlcIdA = 'htlc_a_rfq_1773375728714_lp-c';
const htlcPdaA = deriveHtlcPda(htlcIdA);
const recipientB = new PublicKey('CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW');
const vaultAtaA = deriveAta(htlcPdaA, USDT_MINT);
const recipientAtaA = deriveAta(recipientB, USDT_MINT);

console.log('HTLC A PDA:', htlcPdaA.toBase58());
console.log('Recipient B:', recipientB.toBase58());

const infoA = await conn.getAccountInfo(htlcPdaA);
if (!infoA) {
  console.log('HTLC A PDA not found — already claimed/refunded');
} else {
  console.log('HTLC A status byte @185:', infoA.data[185], '->', ['ACTIVE','REFUNDED','CLAIMED'][infoA.data[185]]);
  
  const dataA = Buffer.alloc(8 + 32);
  CLAIM_DISCRIMINATOR.copy(dataA, 0);
  Buffer.from(preimage).copy(dataA, 8);
  
  const keysA = [
    { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: htlcPdaA, isSigner: false, isWritable: true },
    { pubkey: recipientB, isSigner: false, isWritable: true },
    { pubkey: vaultAtaA, isSigner: false, isWritable: true },
    { pubkey: recipientAtaA, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  const ixA = new TransactionInstruction({ programId: AFOS_HTLC_PROGRAM_ID, keys: keysA, data: dataA });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const txA = new Transaction();
  txA.recentBlockhash = blockhash;
  txA.lastValidBlockHeight = lastValidBlockHeight;
  txA.feePayer = agentKeypair.publicKey;
  txA.add(ixA);
  
  // Simulate first
  const simA = await conn.simulateTransaction(txA, [agentKeypair]);
  console.log('Simulation result:', simA.value.err ? 'FAILED' : 'OK');
  if (simA.value.err) {
    console.log('Simulation logs:', simA.value.logs?.join('\n'));
  } else {
    const sigA = await sendAndConfirmTransaction(conn, txA, [agentKeypair], { commitment: 'confirmed' });
    console.log('Claim A SUCCESS:', sigA);
  }
}

// ── Claim B: Release Agent B's 0.892359 USDT → Agent A (AuSUBiVV) ──────────
console.log('\n=== Claiming HTLC B (USDT → Agent A) ===');
const htlcIdB = 'htlc_b_rfq_1773375728714_lp-c';
const htlcPdaB = deriveHtlcPda(htlcIdB);
const recipientA = new PublicKey('AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk');
const vaultAtaB = deriveAta(htlcPdaB, USDT_MINT);
const recipientAtaB = deriveAta(recipientA, USDT_MINT);

console.log('HTLC B PDA:', htlcPdaB.toBase58());
console.log('Vault ATA B:', vaultAtaB.toBase58());
console.log('Recipient A ATA:', recipientAtaB.toBase58());

const infoB = await conn.getAccountInfo(htlcPdaB);
if (!infoB) {
  console.log('HTLC B PDA not found — already claimed/refunded');
} else {
  console.log('HTLC B status byte @185:', infoB.data[185], '->', ['ACTIVE','REFUNDED','CLAIMED'][infoB.data[185]]);
  
  // Check vault ATA balance
  const vaultInfo = await conn.getAccountInfo(vaultAtaB);
  if (vaultInfo) {
    const balance = vaultInfo.data.readBigUInt64LE(64);
    console.log('Vault ATA balance:', (Number(balance) / 1e6).toFixed(6), 'USDT');
  } else {
    console.log('Vault ATA does not exist!');
  }
  
  // Ensure recipient ATA exists
  const recipientAtaBInfo = await conn.getAccountInfo(recipientAtaB);
  if (!recipientAtaBInfo) {
    console.log('Recipient ATA does not exist — creating it first...');
    // Create ATA instruction
    const createAtaIx = new TransactionInstruction({
      programId: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: recipientAtaB, isSigner: false, isWritable: true },
        { pubkey: recipientA, isSigner: false, isWritable: false },
        { pubkey: USDT_MINT, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent
    });
    const { blockhash: bh } = await conn.getLatestBlockhash('confirmed');
    const createTx = new Transaction();
    createTx.recentBlockhash = bh;
    createTx.feePayer = agentKeypair.publicKey;
    createTx.add(createAtaIx);
    const createSig = await sendAndConfirmTransaction(conn, createTx, [agentKeypair], { commitment: 'confirmed' });
    console.log('Created recipient ATA:', createSig);
  } else {
    console.log('Recipient ATA exists');
  }
  
  const dataB = Buffer.alloc(8 + 32);
  CLAIM_DISCRIMINATOR.copy(dataB, 0);
  Buffer.from(preimage).copy(dataB, 8);
  
  const keysB = [
    { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: htlcPdaB, isSigner: false, isWritable: true },
    { pubkey: recipientA, isSigner: false, isWritable: true },
    { pubkey: vaultAtaB, isSigner: false, isWritable: true },
    { pubkey: recipientAtaB, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  const ixB = new TransactionInstruction({ programId: AFOS_HTLC_PROGRAM_ID, keys: keysB, data: dataB });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const txB = new Transaction();
  txB.recentBlockhash = blockhash;
  txB.lastValidBlockHeight = lastValidBlockHeight;
  txB.feePayer = agentKeypair.publicKey;
  txB.add(ixB);
  
  // Simulate first
  const simB = await conn.simulateTransaction(txB, [agentKeypair]);
  console.log('Simulation result:', simB.value.err ? 'FAILED' : 'OK');
  if (simB.value.err) {
    console.log('Simulation logs:', simB.value.logs?.join('\n'));
  } else {
    const sigB = await sendAndConfirmTransaction(conn, txB, [agentKeypair], { commitment: 'confirmed' });
    console.log('Claim B SUCCESS:', sigB);
  }
}
