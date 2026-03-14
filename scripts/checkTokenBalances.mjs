import { config } from "dotenv";
try { config({ path: ".env" }); } catch {}

const AGENT = "Ey3PYDh9gKukTcGriXo8rb1T11QFxP3pJvnMqkCDQopR";
const USDT  = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC  = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const rpc   = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

const resp = await fetch(rpc, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "getTokenAccountsByOwner",
    params: [AGENT, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]
  })
});
const d = await resp.json();
const accs = d.result?.value ?? [];
let foundUsdt = false, foundUsdc = false;
for (const a of accs) {
  const info = a.account?.data?.parsed?.info;
  const mint = info?.mint;
  const amt  = info?.tokenAmount?.uiAmount ?? 0;
  if (mint === USDT) { console.log("Agent USDT balance:", amt, "USDT"); foundUsdt = true; }
  if (mint === USDC) { console.log("Agent USDC balance:", amt, "USDC"); foundUsdc = true; }
}
if (!foundUsdt) console.log("Agent USDT balance: 0 (no ATA found)");
if (!foundUsdc) console.log("Agent USDC balance: 0 (no ATA found)");

// Also check TNK balance via trac-peer
const tnkRpc = process.env.TNK_PEER_RPC_URL ?? "http://localhost:5001";
const tnkAddr = process.env.TNK_ESCROW_ADDRESS ?? "";
if (tnkAddr) {
  try {
    const r2 = await fetch(`${tnkRpc}/v1/state?key=account/${tnkAddr}`, { signal: AbortSignal.timeout(8000) });
    const d2 = await r2.json();
    console.log("Agent TNK balance (account state):", JSON.stringify(d2?.value ?? "(not found)"));
  } catch (e) {
    console.log("TNK balance check failed:", e.message);
  }
}
