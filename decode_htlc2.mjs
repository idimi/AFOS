/**
 * Decode the on-chain HTLC account data to find the stored recipient address.
 * The HTLC account layout (based on Anchor struct):
 *   8 bytes: discriminator
 *   32 bytes: sender (PublicKey)
 *   32 bytes: recipient (PublicKey)
 *   32 bytes: secret_hash ([u8; 32])
 *   8 bytes: timelock (i64)
 *   8 bytes: amount (u64)
 *   1 byte: status (u8)
 *   1 byte: is_token (bool)
 *   32 bytes: token_mint (PublicKey, optional - only if is_token=true)
 */
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

const HTLC_ADDRESS = '45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ';
const htlcPubkey = new PublicKey(HTLC_ADDRESS);

const accountInfo = await conn.getAccountInfo(htlcPubkey, 'confirmed');
if (!accountInfo) {
  console.error('Account not found!');
  process.exit(1);
}

const data = accountInfo.data;
console.log('Account data length:', data.length, 'bytes');
console.log('Raw data (hex):', data.toString('hex'));
console.log('');

// Parse the account data
let offset = 0;

// 8-byte discriminator
const discriminator = data.slice(0, 8);
console.log('Discriminator:', discriminator.toString('hex'));
offset += 8;

// 32-byte sender
const senderBytes = data.slice(offset, offset + 32);
const sender = new PublicKey(senderBytes);
console.log('Sender:', sender.toBase58());
offset += 32;

// 32-byte recipient
const recipientBytes = data.slice(offset, offset + 32);
const recipient = new PublicKey(recipientBytes);
console.log('Recipient:', recipient.toBase58());
offset += 32;

// 32-byte secret hash
const secretHash = data.slice(offset, offset + 32);
console.log('Secret hash:', secretHash.toString('hex'));
offset += 32;

// 8-byte timelock (i64 LE)
const timelock = data.readBigInt64LE(offset);
console.log('Timelock:', timelock.toString(), '=', new Date(Number(timelock) * 1000).toISOString());
offset += 8;

// 8-byte amount (u64 LE)
const amount = data.readBigUInt64LE(offset);
console.log('Amount (lamports):', amount.toString(), '=', Number(amount) / 1e9, 'SOL');
offset += 8;

// 1-byte status
const status = data[offset];
console.log('Status:', status, status === 0 ? '(Active)' : status === 1 ? '(Claimed)' : '(Refunded)');
offset += 1;

// 1-byte is_token
if (offset < data.length) {
  const isToken = data[offset];
  console.log('Is token:', isToken === 1 ? 'YES' : 'NO');
  offset += 1;
  
  if (isToken === 1 && offset + 32 <= data.length) {
    const mintBytes = data.slice(offset, offset + 32);
    const mint = new PublicKey(mintBytes);
    console.log('Token mint:', mint.toBase58());
  }
}

console.log('\nSummary:');
console.log('  Sender (locked by):', sender.toBase58());
console.log('  Recipient (receives):', recipient.toBase58());
console.log('  Expected recipient from DB: AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk');
console.log('  Recipient matches DB:', recipient.toBase58() === 'AuSUBiVV1FYnCkBiqKCAHWesvDm6BQipQ3hcRcvg6HQk');
