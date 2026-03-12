/**
 * Test the refund instruction with the user's wallet (AuSUBiVV...) as sender.
 * We confirmed from on-chain decode that:
 *   sender = AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk (user's Phantom wallet)
 *   htlcPda = 45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ
 *   timelock expired at 2026-03-11T06:02:29 UTC
 *
 * We can't actually sign with the user's Phantom wallet from the server,
 * but we can simulate with a dummy signer to verify the instruction passes.
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

const PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const HTLC_PDA = new PublicKey('45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ');
const USER_WALLET = new PublicKey('AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk');

// Anchor discriminator for refund: SHA256("global:refund")[0..8]
const REFUND_DISCRIMINATOR = Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]);

// Build the refund instruction with user wallet as sender
const refundIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: USER_WALLET, isSigner: true, isWritable: true },
    { pubkey: HTLC_PDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(REFUND_DISCRIMINATOR),
});

// Use a dummy keypair as fee payer for simulation (we can't sign with user's wallet)
// The simulation will still validate the instruction logic
const dummyPayer = Keypair.generate();

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
const tx = new Transaction();
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = USER_WALLET; // User wallet is fee payer AND sender
tx.add(refundIx);

console.log('Simulating refund with user wallet as sender...');
console.log('User wallet (sender):', USER_WALLET.toBase58());
console.log('HTLC PDA:', HTLC_PDA.toBase58());

// Simulate with sigVerify=false so we don't need the actual private key
const simResult = await conn.simulateTransaction(tx, undefined, [USER_WALLET]);

if (simResult.value.err) {
  console.log('SIMULATION FAILED:', JSON.stringify(simResult.value.err));
  const errorLogs = simResult.value.logs?.filter(l => l.includes('Error') || l.includes('error') || l.includes('failed'));
  console.log('Error logs:', errorLogs?.join('\n'));
  console.log('All logs:', simResult.value.logs?.join('\n'));
} else {
  console.log('SIMULATION PASSED ✓');
  console.log('Logs:', simResult.value.logs?.join('\n'));
  console.log('\nThe refund instruction is valid!');
  console.log('The user can claim by signing this transaction with their Phantom wallet.');
}
