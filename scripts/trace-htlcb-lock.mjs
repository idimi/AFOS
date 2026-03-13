import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

// HTLC B lock tx
const lockTx = '2c6Gqkh9K3xK9qgaSEc1rKbUSpM9z2Wd2tqoEwnpkqs5pMHG2ndJWTirrgiJPtBNFcCYR2UmTDVXgMpbKH69y1MX';
console.log('=== HTLC B Lock Transaction ===');
const tx = await conn.getTransaction(lockTx, { maxSupportedTransactionVersion: 0 });
if (!tx) { console.log('Transaction not found'); process.exit(0); }

console.log('Result:', tx.meta?.err ? 'FAILED: ' + JSON.stringify(tx.meta.err) : 'SUCCESS');
console.log('\nAccounts:');
const accounts = tx.transaction?.message?.staticAccountKeys?.map(k => k.toBase58()) ?? [];
accounts.forEach((a, i) => console.log(`  [${i}] ${a}`));

console.log('\nLogs:');
tx.meta?.logMessages?.forEach(l => console.log(' ', l));

console.log('\nBalance changes:');
const preBalances = tx.meta?.preBalances ?? [];
const postBalances = tx.meta?.postBalances ?? [];
const preTokenBalances = tx.meta?.preTokenBalances ?? [];
const postTokenBalances = tx.meta?.postTokenBalances ?? [];

accounts.forEach((a, i) => {
  const diff = (postBalances[i] ?? 0) - (preBalances[i] ?? 0);
  if (diff !== 0) console.log(`  [${i}] ${a}: ${diff > 0 ? '+' : ''}${diff} lamports`);
});

console.log('\nToken balance changes:');
postTokenBalances.forEach(tb => {
  const pre = preTokenBalances.find(p => p.accountIndex === tb.accountIndex);
  const preAmt = pre?.uiTokenAmount?.uiAmount ?? 0;
  const postAmt = tb.uiTokenAmount?.uiAmount ?? 0;
  if (preAmt !== postAmt) {
    console.log(`  [${tb.accountIndex}] ${accounts[tb.accountIndex]}: ${preAmt} -> ${postAmt} ${tb.mint}`);
  }
});

// Now check what F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9 actually is
console.log('\n=== What is F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9? ===');
const pda = new PublicKey('F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9');
const pdaInfo = await conn.getAccountInfo(pda);
if (!pdaInfo) { console.log('Account does not exist'); }
else {
  console.log('Owner:', pdaInfo.owner.toBase58());
  console.log('Lamports:', pdaInfo.lamports);
  console.log('Data length:', pdaInfo.data.length);
  if (pdaInfo.owner.toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
    console.log('This is a TOKEN ACCOUNT (not an HTLC PDA!)');
    // Parse token account: mint at offset 0 (32 bytes), owner at offset 32 (32 bytes), amount at offset 64 (8 bytes)
    const mint = new PublicKey(pdaInfo.data.slice(0, 32)).toBase58();
    const owner = new PublicKey(pdaInfo.data.slice(32, 64)).toBase58();
    const amount = pdaInfo.data.readBigUInt64LE(64);
    console.log('Token mint:', mint);
    console.log('Token owner:', owner);
    console.log('Token amount (raw):', amount.toString());
    console.log('Token amount (USDT):', (Number(amount) / 1e6).toFixed(6));
  }
}

// Derive what the HTLC PDA should be for htlc_b_rfq_1773375728714_lp-c
const AFOS_HTLC_PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const htlcId = 'htlc_b_rfq_1773375728714_lp-c';
const htlcIdBytes = new Uint8Array(32);
const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
htlcIdBytes.set(encoded);
const [expectedPda] = PublicKey.findProgramAddressSync([Buffer.from('htlc'), htlcIdBytes], AFOS_HTLC_PROGRAM_ID);
console.log('\nExpected HTLC B PDA:', expectedPda.toBase58());
console.log('Actual HTLC B PDA in DB:', 'F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9');
console.log('Match:', expectedPda.toBase58() === 'F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9');

// Check the expected PDA
const expectedInfo = await conn.getAccountInfo(expectedPda);
if (expectedInfo) {
  console.log('\nExpected PDA exists!');
  console.log('Owner:', expectedInfo.owner.toBase58());
  console.log('Lamports:', expectedInfo.lamports);
  console.log('Data length:', expectedInfo.data.length);
  const status = expectedInfo.data[185];
  console.log('Status @185:', status, '->', ['ACTIVE','REFUNDED','CLAIMED'][status] ?? 'unknown');
} else {
  console.log('\nExpected PDA does NOT exist on-chain');
}
