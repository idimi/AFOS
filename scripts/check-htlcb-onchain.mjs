import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const conn = new Connection(RPC, 'confirmed');

const htlcBPda = new PublicKey('F4dURpRk6qfM8WMsToCssXwZuqmvGBYRSJ8D917jbJb9');
const info = await conn.getAccountInfo(htlcBPda);
if (!info) { console.log('HTLC B PDA: CLOSED'); process.exit(0); }
console.log('HTLC B PDA lamports:', info.lamports);
console.log('HTLC B PDA data length:', info.data.length);
console.log('HTLC B PDA owner:', info.owner.toBase58());

// For token HTLC, check bytes around 150-200 for status
console.log('\nBytes 150-200:');
for (let i = 150; i <= 200; i++) {
  const b = info.data[i];
  if (b !== undefined && b <= 2) {
    console.log('  offset', i, '=', b, '->', ['ACTIVE','REFUNDED','CLAIMED'][b]);
  }
}

// Check the vault ATA
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const [vaultAta] = PublicKey.findProgramAddressSync(
  [htlcBPda.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), USDT_MINT.toBuffer()],
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID
);
console.log('\nVault ATA:', vaultAta.toBase58());
const vaultInfo = await conn.getAccountInfo(vaultAta);
if (vaultInfo) {
  console.log('Vault ATA lamports:', vaultInfo.lamports);
  console.log('Vault ATA data length:', vaultInfo.data.length);
  const balance = vaultInfo.data.readBigUInt64LE(64);
  console.log('Vault ATA token balance (raw):', balance.toString());
  console.log('Vault ATA USDT balance:', (Number(balance) / 1e6).toFixed(6), 'USDT');
} else {
  console.log('Vault ATA: does NOT exist');
}

// Also check HTLC A
console.log('\n=== HTLC A (SOL lock) ===');
const htlcAPda = new PublicKey('7n2BWJUeAdspNPrAQ4CsjfsAzC5giX4k9N89rUGQuHZn');
const infoA = await conn.getAccountInfo(htlcAPda);
if (!infoA) { console.log('HTLC A PDA: CLOSED'); }
else {
  console.log('HTLC A lamports:', infoA.lamports, '=', (infoA.lamports / 1e9).toFixed(9), 'SOL');
  console.log('HTLC A data length:', infoA.data.length);
  const statusA = infoA.data[185];
  console.log('HTLC A status @185:', statusA, '->', ['ACTIVE','REFUNDED','CLAIMED'][statusA] ?? 'unknown');
}

// Check the reveal endpoint
console.log('\n=== Checking Oracle API ===');
const ORACLE_URL = process.env.ORACLE_API_URL;
console.log('ORACLE_API_URL:', ORACLE_URL);
try {
  const resp = await fetch(`${ORACLE_URL}/health`, { signal: AbortSignal.timeout(5000) });
  console.log('Oracle health check:', resp.status, resp.statusText);
} catch (e) {
  console.log('Oracle health check FAILED:', e.message);
}

// Check the signaling server
const SIGNALING_URL = process.env.VITE_ORACLE_URL || process.env.ORACLE_API_URL;
console.log('Signaling URL:', SIGNALING_URL);
