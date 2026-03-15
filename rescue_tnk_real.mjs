/**
 * rescue_tnk_real.mjs — Manual rescue script for stuck TNK swaps
 * 
 * Uses trac-crypto-api to build and broadcast a real signed transfer
 * on the Trac Network mainnet via tracapi.trac.network.
 * 
 * Usage: node rescue_tnk_real.mjs
 */

import tracCrypto from 'trac-crypto-api';

const TRAC_API = 'https://tracapi.trac.network';

// Addresses
const ESCROW_ADDRESS = 'trac1xktn4w0zyhlj7lqm2h3r0r2emazmzgzxlq9rr3u6cvx98vfw6hmsu7zx9z';
const RECIPIENT_ADDRESS = 'trac1qj4a9cg7w777wj8pmkdga0624r3uq69ktejvfq2d4uytcr6zq45q0wmfy8';

// Amount: 2 TNK = 2 * 10^18 raw units
const TNK_DECIMALS = 18n;
const TNK_UNIT = 10n ** TNK_DECIMALS;
const AMOUNT_RAW = 2n * TNK_UNIT; // 2 TNK

function rawToAmountHex(raw) {
  return raw.toString(16).padStart(32, '0');
}

async function main() {
  const wifHex = process.env.TNK_HTLC_WIF;
  if (!wifHex || wifHex.length !== 128) {
    console.error('❌ TNK_HTLC_WIF not set or wrong length:', wifHex?.length);
    process.exit(1);
  }

  const secretKey = Buffer.from(wifHex, 'hex');
  const { address: derivedAddress } = tracCrypto.address.fromSecretKey('trac', secretKey);
  
  console.log('=== TNK Rescue Transfer ===');
  console.log('From (escrow):', ESCROW_ADDRESS);
  console.log('To (Agent B): ', RECIPIENT_ADDRESS);
  console.log('Amount:        2 TNK');
  console.log('Derived addr: ', derivedAddress);
  
  if (derivedAddress !== ESCROW_ADDRESS) {
    console.error('❌ Key mismatch! Derived:', derivedAddress);
    process.exit(1);
  }
  console.log('✅ Key verified matches escrow address');

  // Step 1: Get current txv
  console.log('\n[1/4] Fetching txv from tracapi...');
  const txvRes = await fetch(`${TRAC_API}/v1/txv`);
  const txvData = await txvRes.json();
  const txv = txvData.txv;
  console.log('txv:', txv);

  // Step 2: Check current balances
  console.log('\n[2/4] Checking balances...');
  const [escrowBal, recipientBal] = await Promise.all([
    fetch(`${TRAC_API}/v1/balance/${ESCROW_ADDRESS}`).then(r => r.json()),
    fetch(`${TRAC_API}/v1/balance/${RECIPIENT_ADDRESS}`).then(r => r.json()),
  ]);
  const escrowRaw = BigInt(escrowBal.balance || '0');
  const recipientRaw = BigInt(recipientBal.balance || '0');
  console.log('Escrow balance:   ', (escrowRaw / TNK_UNIT).toString(), 'TNK (raw:', escrowBal.balance, ')');
  console.log('Recipient balance:', (recipientRaw / TNK_UNIT).toString(), 'TNK (raw:', recipientBal.balance, ')');
  
  if (escrowRaw < AMOUNT_RAW) {
    console.error(`❌ Insufficient balance: escrow has ${escrowRaw} raw but need ${AMOUNT_RAW} raw`);
    process.exit(1);
  }

  // Step 3: Build and sign the transaction
  console.log('\n[3/4] Building and signing transaction...');
  const amountHex = rawToAmountHex(AMOUNT_RAW);
  console.log('amountHex:', amountHex);
  
  const txData = await tracCrypto.transaction.preBuild(
    ESCROW_ADDRESS,
    RECIPIENT_ADDRESS,
    amountHex,
    txv
  );
  console.log('txHash:', txData.hash.toString('hex'));
  
  const payload = tracCrypto.transaction.build(txData, secretKey);
  console.log('payload (first 40 chars):', payload.slice(0, 40) + '...');

  // Step 4: Broadcast
  console.log('\n[4/4] Broadcasting to Trac Network...');
  const broadcastRes = await fetch(`${TRAC_API}/v1/broadcast-transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  
  const responseText = await broadcastRes.text();
  console.log(`HTTP ${broadcastRes.status}:`, responseText);
  
  if (!broadcastRes.ok) {
    console.error('❌ Broadcast failed!');
    process.exit(1);
  }
  
  let responseJson = {};
  try { responseJson = JSON.parse(responseText); } catch { /* ignore */ }
  
  const txHash = responseJson.result?.tx ?? txData.hash.toString('hex');
  console.log('\n✅ SUCCESS!');
  console.log('txHash:', txHash);
  console.log('\nVerify at: https://tracapi.trac.network/v1/balance/' + RECIPIENT_ADDRESS);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
