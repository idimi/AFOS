/**
 * Re-decode the HTLC account data carefully.
 * Raw hex: b17c6894280a69c0 68746c635f615f7266715f313737333230353334363838305f6c702d33 00000093282e951e09ae1f36919575972efbb2773c07691373d4b723c1d9b3c3feabb9b22395063d2794568b8988eabc30124082fee9abcfa0d6a4a790be500cafd62b5a6a54b18a34f72035ff750851a588b3afc1e2bbdd62759ff18a6438dc3b293e7505b1690000000040787d010000000000000000000000000000000000000000000000000000000000000000000000000000ff0000000000000000000000000000000000000000000000000000000000000000
 *
 * The Anchor HTLC struct is likely:
 *   discriminator: [u8; 8]
 *   htlc_id: [u8; 32]  ← 32-byte fixed string (not PublicKey!)
 *   sender: PublicKey (32 bytes)
 *   recipient: PublicKey (32 bytes)
 *   secret_hash: [u8; 32]
 *   timelock: i64 (8 bytes)
 *   amount: u64 (8 bytes)
 *   status: u8
 *   ...
 */
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.VITE_SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');

const HTLC_ADDRESS = '45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ';
const htlcPubkey = new PublicKey(HTLC_ADDRESS);

const accountInfo = await conn.getAccountInfo(htlcPubkey, 'confirmed');
const data = accountInfo.data;
console.log('Total bytes:', data.length);
console.log('Raw hex:', data.toString('hex'));
console.log('');

// Try layout WITH htlc_id field (32 bytes after discriminator)
let offset = 0;

const discriminator = data.slice(0, 8);
console.log('Discriminator (8):', discriminator.toString('hex'));
offset += 8;

// htlc_id as 32-byte string
const htlcIdBytes = data.slice(offset, offset + 32);
const htlcIdStr = Buffer.from(htlcIdBytes).toString('utf8').replace(/\0/g, '');
console.log('htlc_id (32 bytes as string):', htlcIdStr);
offset += 32;

// sender
const senderBytes = data.slice(offset, offset + 32);
const sender = new PublicKey(senderBytes);
console.log('Sender (32):', sender.toBase58());
offset += 32;

// recipient
const recipientBytes = data.slice(offset, offset + 32);
const recipient = new PublicKey(recipientBytes);
console.log('Recipient (32):', recipient.toBase58());
offset += 32;

// secret_hash
const secretHash = data.slice(offset, offset + 32);
console.log('Secret hash (32):', secretHash.toString('hex'));
offset += 32;

// timelock (i64 LE)
const timelockRaw = data.readBigInt64LE(offset);
console.log('Timelock raw:', timelockRaw.toString());
if (timelockRaw > 0 && timelockRaw < 9999999999n) {
  console.log('Timelock as unix:', new Date(Number(timelockRaw) * 1000).toISOString());
}
offset += 8;

// amount (u64 LE)
const amount = data.readBigUInt64LE(offset);
console.log('Amount (lamports):', amount.toString(), '=', Number(amount) / 1e9, 'SOL');
offset += 8;

// status
const status = data[offset];
console.log('Status:', status);
offset += 1;

// remaining bytes
console.log('Remaining bytes:', data.length - offset);
console.log('Remaining hex:', data.slice(offset).toString('hex'));

// Also try: maybe htlc_id is a Borsh String (4-byte length prefix + bytes)
console.log('\n--- Alternative: Borsh String layout ---');
offset = 8; // after discriminator
const strLen = data.readUInt32LE(offset);
console.log('String length prefix:', strLen);
if (strLen > 0 && strLen < 100) {
  const strBytes = data.slice(offset + 4, offset + 4 + strLen);
  console.log('htlc_id string:', strBytes.toString('utf8'));
  offset = offset + 4 + strLen;
  
  const senderB = data.slice(offset, offset + 32);
  console.log('Sender:', new PublicKey(senderB).toBase58());
  offset += 32;
  
  const recipientB = data.slice(offset, offset + 32);
  console.log('Recipient:', new PublicKey(recipientB).toBase58());
}
