import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";

// Load .env
try {
  dotenv.config({ path: "/home/ubuntu/afos-dashboard/.env" });
} catch(e) {}

const solHtlcKey = process.env.SOL_HTLC_KEY;
const solAgentKey = process.env.SOL_AGENT_KEY;

if (solHtlcKey) {
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(solHtlcKey));
    console.log("SOL_HTLC_KEY pubkey:", kp.publicKey.toBase58());
  } catch(e) {
    console.log("SOL_HTLC_KEY error:", e.message);
  }
}

if (solAgentKey) {
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(solAgentKey));
    console.log("SOL_AGENT_KEY pubkey:", kp.publicKey.toBase58());
  } catch(e) {
    console.log("SOL_AGENT_KEY error:", e.message);
  }
}

if (!solHtlcKey && !solAgentKey) {
  console.log("No SOL keys found in env");
}
