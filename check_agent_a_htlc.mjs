/**
 * Check Agent A's HTLC PDA on-chain state.
 * Transaction: 3n8UotKG3iUCC45wmpnGxdYgpxmhZwNT2Vtx5zD8cKbStW9GWoBJFB7Ja7eshyBMaiQjMvVz1QB9DRQP3x8GF3Bz
 * HTLC PDA from Solscan: C6cFZfKkk1cwLVdwoRf5LTMe9SUVVenevMuwfxNdM9hK
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const connection = new Connection(RPC, 'confirmed');

// The HTLC PDA from the lock transaction
const HTLC_PDA = new PublicKey('C6cFZfKkk1cwLVdwoRf5LTMe9SUVVenevMuwfxNdM9hK');

console.log('Checking HTLC PDA:', HTLC_PDA.toBase58());

// Check if the HTLC PDA still exists (has SOL locked)
const htlcInfo = await connection.getAccountInfo(HTLC_PDA);
if (!htlcInfo) {
  console.log('\n✅ HTLC PDA does NOT exist on-chain.');
  console.log('   This means the SOL was already REFUNDED back to Agent A.');
  console.log('   The refund transaction was submitted by the server (SOL_HTLC_KEY).');
  console.log('   Check Agent A wallet balance — the SOL should be there already.');
} else {
  console.log('\n⚠️  HTLC PDA STILL EXISTS on-chain!');
  console.log('   Balance:', htlcInfo.lamports / LAMPORTS_PER_SOL, 'SOL');
  console.log('   Data length:', htlcInfo.data.length, 'bytes');
  console.log('   Owner:', htlcInfo.owner.toBase58());
  console.log('   The SOL is still locked and needs to be refunded!');
  // Print first 100 bytes of data as hex for debugging
  console.log('   Data (hex):', Buffer.from(htlcInfo.data).toString('hex').slice(0, 200));
}

// Also check the lock transaction details
console.log('\nFetching lock transaction...');
const txSig = '3n8UotKG3iUCC45wmpnGxdYgpxmhZwNT2Vtx5zD8cKbStW9GWoBJFB7Ja7eshyBMaiQjMvVz1QB9DRQP3x8GF3Bz';
const tx = await connection.getTransaction(txSig, { maxSupportedTransactionVersion: 0 });
if (tx) {
  console.log('Block time:', new Date((tx.blockTime ?? 0) * 1000).toISOString());
  console.log('Status:', tx.meta?.err ? 'FAILED: ' + JSON.stringify(tx.meta.err) : 'SUCCESS');
  
  // Get the accounts involved
  const accounts = tx.transaction.message.staticAccountKeys ?? [];
  console.log('\nAccounts in transaction (with balance changes):');
  accounts.forEach((acc, i) => {
    const pre = tx.meta?.preBalances[i] ?? 0;
    const post = tx.meta?.postBalances[i] ?? 0;
    const diff = (post - pre) / LAMPORTS_PER_SOL;
    if (Math.abs(diff) > 0.0001) {
      console.log(`  [${i}] ${acc.toBase58()} | diff: ${diff > 0 ? '+' : ''}${diff.toFixed(6)} SOL`);
    } else {
      console.log(`  [${i}] ${acc.toBase58()} | no change`);
    }
  });
} else {
  console.log('Transaction not found');
}

// Check recent transactions on the HTLC PDA to see if a refund was already issued
console.log('\nChecking recent transactions on HTLC PDA...');
const sigs = await connection.getSignaturesForAddress(HTLC_PDA, { limit: 5 });
console.log(`Found ${sigs.length} transaction(s) on HTLC PDA:`);
for (const sig of sigs) {
  console.log(`  ${sig.signature.slice(0, 20)}... | ${new Date((sig.blockTime ?? 0) * 1000).toISOString()} | err: ${sig.err ? JSON.stringify(sig.err) : 'none'}`);
}
