/**
 * Check Agent B's USDT balance and HTLC account state.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const connection = new Connection(RPC, 'confirmed');

const AFOS_HTLC_PROGRAM_ID = new PublicKey('XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW');
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Agent B's wallet (from browser logs)
const AGENT_B = new PublicKey('CzP3GvDsLFfwqvPRm3hCtVYHP7PcnbUEqNBssevqepiW');

// Derive HTLC PDA using htlcId = "htlc_b_rfq_1773283782213_lp-c"
const htlcId = 'htlc_b_rfq_1773283782213_lp-c';
const htlcIdBytes = Buffer.from(htlcId.padEnd(32, '\0').slice(0, 32));

function deriveHtlcPda(htlcIdBytes) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('htlc'), htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );
}

function deriveAta(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

const [htlcPda] = deriveHtlcPda(htlcIdBytes);
const vaultAta = deriveAta(htlcPda, USDT_MINT);
const senderAta = deriveAta(AGENT_B, USDT_MINT);

console.log('HTLC PDA:', htlcPda.toBase58());
console.log('Vault ATA:', vaultAta.toBase58());
console.log('Sender ATA:', senderAta.toBase58());

// Check if accounts exist
const [htlcInfo, vaultInfo, senderAtaInfo] = await Promise.all([
  connection.getAccountInfo(htlcPda),
  connection.getAccountInfo(vaultAta),
  connection.getAccountInfo(senderAta),
]);

console.log('\nAccount existence:');
console.log('  HTLC PDA exists:', !!htlcInfo, htlcInfo ? `(${htlcInfo.data.length} bytes, owner: ${htlcInfo.owner.toBase58().slice(0,8)}...)` : '');
console.log('  Vault ATA exists:', !!vaultInfo, vaultInfo ? `(${vaultInfo.data.length} bytes)` : '');
console.log('  Sender ATA exists:', !!senderAtaInfo, senderAtaInfo ? `(${senderAtaInfo.data.length} bytes)` : '');

// Check Agent B's USDT balance
if (senderAtaInfo) {
  const resp = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTokenAccountBalance',
      params: [senderAta.toBase58()]
    })
  });
  const data = await resp.json();
  console.log('\nAgent B USDT balance:', data.result?.value?.uiAmountString, 'USDT');
} else {
  console.log('\nAgent B has NO USDT ATA — they have 0 USDT!');
}

// Check Agent B's SOL balance
const solBal = await connection.getBalance(AGENT_B);
console.log('Agent B SOL balance:', solBal / 1e9, 'SOL');
