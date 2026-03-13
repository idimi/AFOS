import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

// Accounts from the failed tx:
// [0] CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW = sender (Agent B wallet)
// [1] 9HcED5XxBAvirJcZgH4ZHsFvFNt2tJ7nHXTdVSzhkCVC = HTLC PDA
// [2] CbKtiBEnZVdvRqQR6jDDVMVQryqiaMnoM77XJ26HJoiP = ??? (this is the one that failed - instruction index 2)
// [3] Ev2KWfWnb9ZnHGoyVJT4iJHM5uzghDzvYjSsH2TqBeiU = ???
// [6] Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB = USDT mint

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const accounts = [
  { addr: 'CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW', label: '[0] sender (Agent B)' },
  { addr: '9HcED5XxBAvirJcZgH4ZHsFvFNt2tJ7nHXTdVSzhkCVC', label: '[1] HTLC PDA' },
  { addr: 'CbKtiBEnZVdvRqQR6jDDVMVQryqiaMnoM77XJ26HJoiP', label: '[2] FAILED ACCOUNT' },
  { addr: 'Ev2KWfWnb9ZnHGoyVJT4iJHM5uzghDzvYjSsH2TqBeiU', label: '[3] 4th account' },
];

console.log('=== Account Analysis for Failed Tx ===\n');
for (const { addr, label } of accounts) {
  const info = await conn.getAccountInfo(new PublicKey(addr));
  if (!info) {
    console.log(`${label}`);
    console.log(`  ${addr}`);
    console.log(`  → NULL (does not exist on-chain!)`);
  } else {
    const isTokenAccount = info.owner.toBase58() === TOKEN_PROGRAM;
    console.log(`${label}`);
    console.log(`  ${addr}`);
    console.log(`  → owner: ${info.owner.toBase58()}`);
    console.log(`  → lamports: ${info.lamports}`);
    console.log(`  → dataLen: ${info.data.length}`);
    if (isTokenAccount && info.data.length >= 32) {
      // Parse token account mint (bytes 0-31)
      const mint = new PublicKey(info.data.slice(0, 32)).toBase58();
      const owner = new PublicKey(info.data.slice(32, 64)).toBase58();
      // Amount at bytes 64-71 (u64 LE)
      const amount = info.data.readBigUInt64LE(64);
      console.log(`  → TOKEN ACCOUNT: mint=${mint.slice(0,12)}... owner=${owner.slice(0,12)}... amount=${amount}`);
      if (mint === USDT_MINT) console.log(`  → ✅ USDT token account`);
    }
  }
  console.log('');
}

// Now derive what the vault ATA SHOULD be
const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
const htlcPda = new PublicKey('9HcED5XxBAvirJcZgH4ZHsFvFNt2tJ7nHXTdVSzhkCVC');
const usdtMint = new PublicKey(USDT_MINT);
const senderPubkey = new PublicKey('CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW');

const expectedVaultAta = getAssociatedTokenAddressSync(usdtMint, htlcPda, true);
const expectedSenderAta = getAssociatedTokenAddressSync(usdtMint, senderPubkey, false);

console.log('=== Expected ATAs ===');
console.log(`Expected vault ATA (USDT for HTLC PDA): ${expectedVaultAta.toBase58()}`);
console.log(`Expected sender ATA (USDT for sender):  ${expectedSenderAta.toBase58()}`);
console.log('');
console.log(`Account [2] in tx: CbKtiBEnZVdvRqQR6jDDVMVQryqiaMnoM77XJ26HJoiP`);
console.log(`Account [3] in tx: Ev2KWfWnb9ZnHGoyVJT4iJHM5uzghDzvYjSsH2TqBeiU`);
console.log('');
console.log(`Vault ATA matches [2]? ${expectedVaultAta.toBase58() === 'CbKtiBEnZVdvRqQR6jDDVMVQryqiaMnoM77XJ26HJoiP'}`);
console.log(`Vault ATA matches [3]? ${expectedVaultAta.toBase58() === 'Ev2KWfWnb9ZnHGoyVJT4iJHM5uzghDzvYjSsH2TqBeiU'}`);
console.log(`Sender ATA matches [2]? ${expectedSenderAta.toBase58() === 'CbKtiBEnZVdvRqQR6jDDVMVQryqiaMnoM77XJ26HJoiP'}`);
console.log(`Sender ATA matches [3]? ${expectedSenderAta.toBase58() === 'Ev2KWfWnb9ZnHGoyVJT4iJHM5uzghDzvYjSsH2TqBeiU'}`);

// Check if vault ATA exists
const vaultAtaInfo = await conn.getAccountInfo(expectedVaultAta);
const senderAtaInfo = await conn.getAccountInfo(expectedSenderAta);
console.log(`\nVault ATA exists? ${vaultAtaInfo ? 'YES' : 'NO (needs to be created first!)'}`);
console.log(`Sender ATA exists? ${senderAtaInfo ? 'YES' : 'NO'}`);
