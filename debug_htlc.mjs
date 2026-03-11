/**
 * Debug script to verify PDA derivation for the stuck HTLC
 * Known PDA: 45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ
 * Known htlcId from on-chain data: "htlc_a_rfq_17732053346880_lp-3"
 */
import { PublicKey, Connection } from "@solana/web3.js";

const AFOS_HTLC_PROGRAM_ID = new PublicKey("XuryiXM1GBQVbFr9m2i4LhrtSbcaUARCDxQvF66ZWRW");
const KNOWN_PDA = "45jdLtyQBrbCMz6wpC1kgtuQZxASH3w5LWg6UhbTYTLQ";
const SOL_RPC_URL = process.env.VITE_SOL_RPC_URL || "https://solana-rpc.publicnode.com";

function htlcIdToBytes(htlcId) {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(htlcId.slice(0, 32));
  bytes.set(encoded);
  return bytes;
}

function deriveHtlcPda(htlcIdBytes) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("htlc"), htlcIdBytes],
    AFOS_HTLC_PROGRAM_ID
  );
}

// Test 1: Derive PDA from the htlcId found in on-chain data
const htlcId = "htlc_a_rfq_17732053346880_lp-3";
console.log(`\nhtlcId from on-chain: "${htlcId}" (length: ${htlcId.length})`);
const htlcIdBytes = htlcIdToBytes(htlcId);
console.log("htlcIdBytes (hex):", Buffer.from(htlcIdBytes).toString("hex"));
const [pda, bump] = deriveHtlcPda(htlcIdBytes);
console.log(`Derived PDA: ${pda.toBase58()}`);
console.log(`Expected PDA: ${KNOWN_PDA}`);
console.log(`Match: ${pda.toBase58() === KNOWN_PDA}`);

// Test 2: Try fetching the account from RPC
console.log(`\n--- Fetching account from RPC: ${SOL_RPC_URL} ---`);
const connection = new Connection(SOL_RPC_URL, "confirmed");
try {
  const accountInfo = await connection.getAccountInfo(new PublicKey(KNOWN_PDA));
  if (accountInfo) {
    console.log("Account found!");
    console.log("Owner:", accountInfo.owner.toBase58());
    console.log("Lamports:", accountInfo.lamports);
    console.log("Data length:", accountInfo.data.length);
    
    // Decode the htlcId from account data
    const data = Buffer.from(accountInfo.data);
    const htlcIdFromData = data.slice(8, 40).toString("utf8").replace(/\0/g, "");
    console.log(`htlcId from account data: "${htlcIdFromData}"`);
    
    // Decode sender
    const sender = new PublicKey(data.slice(40, 72)).toBase58();
    console.log("Sender:", sender);
    
    // Decode recipient
    const recipient = new PublicKey(data.slice(72, 104)).toBase58();
    console.log("Recipient:", recipient);
    
    // Decode timelock
    const timelock = Number(data.readBigInt64LE(136));
    console.log("Timelock:", timelock, "=>", new Date(timelock * 1000).toISOString());
    console.log("Expired:", Date.now() / 1000 > timelock);
    
    // Decode amount
    const amount = data.readBigUInt64LE(144);
    console.log("Amount (lamports):", amount.toString());
    console.log("Amount (SOL):", Number(amount) / 1e9);
    
    // Decode claimed/refunded
    const claimed = data[208] !== 0;
    const refunded = data[209] !== 0;
    console.log("Claimed:", claimed);
    console.log("Refunded:", refunded);
  } else {
    console.log("Account NOT found on-chain!");
  }
} catch (err) {
  console.error("RPC error:", err.message);
}

// Test 3: Check what the DB query would produce
// The rfqId in DB is likely "rfq_17732053346880_lp-3dcc9..." (some suffix)
// Let's check what candidates the current code would generate
console.log("\n--- Testing candidate generation ---");
const testRfqIds = [
  "rfq_17732053346880_lp-3dcc9",
  "rfq_1773205334688_lp-3dcc9",
  "rfq_17732053346880_lp-3",
];

for (const rfqId of testRfqIds) {
  console.log(`\nrfqId: "${rfqId}"`);
  const rfqSuffix = rfqId.startsWith("rfq_") ? rfqId.slice(4) : rfqId;
  
  const candidates = [
    `htlc_a_rfq_${rfqSuffix}`,
    `htlc_a_${rfqId}`,
    `htlc_b_rfq_${rfqSuffix}`,
    `htlc_b_${rfqId}`,
  ];
  
  for (const c of candidates) {
    const truncated = c.slice(0, 32);
    const bytes = htlcIdToBytes(c);
    const [p] = deriveHtlcPda(bytes);
    const match = p.toBase58() === KNOWN_PDA;
    console.log(`  "${truncated}" => ${p.toBase58()} ${match ? "✅ MATCH" : ""}`);
  }
}

// Test 4: Brute-force — try the exact htlcId from on-chain
console.log("\n--- Direct derivation from on-chain htlcId ---");
const directBytes = htlcIdToBytes("htlc_a_rfq_17732053346880_lp-3");
const [directPda] = deriveHtlcPda(directBytes);
console.log(`"htlc_a_rfq_17732053346880_lp-3" => ${directPda.toBase58()}`);
console.log(`Match: ${directPda.toBase58() === KNOWN_PDA}`);
