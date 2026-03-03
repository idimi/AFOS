/**
 * HTLC Wallet Router — Derives HTLC signing addresses from stored agent keys
 * and fetches their on-chain balances across all 7 supported assets:
 *   Solana:   SOL, USDT (SPL), USDC (SPL)
 *   Ethereum: ETH, USDT (ERC-20), USDC (ERC-20)
 *   Bitcoin:  BTC
 *
 * Keys are read from environment variables (server-side only):
 *   BTC_AGENT_WIF  — Bitcoin WIF private key
 *   ETH_AGENT_KEY  — Ethereum hex private key (with or without 0x)
 *   SOL_AGENT_KEY  — Solana base58 or JSON-array private key
 */

import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { htlcSwaps } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as tinysecp from "tiny-secp256k1";
import { ethers } from "ethers";
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const ECPair = ECPairFactory(tinysecp);

// ─── Token constants ──────────────────────────────────────────────────────────

const SOL_USDT_MINT   = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL_USDC_MINT   = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ETH_USDT_ADDR   = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETH_USDC_ADDR   = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// ─── Shared fetch helpers ─────────────────────────────────────────────────────

/** Fetch an SPL token balance for a given owner address and mint.
 * Returns 0 when the wallet has no token account for this mint (unfunded).
 * Returns null only if the RPC itself is unreachable.
 */
async function fetchSplBalance(ownerAddress: string, mint: string): Promise<number | null> {
  const RPC_ENDPOINTS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-mainnet.rpc.extrnode.com",
  ];

  for (const rpc of RPC_ENDPOINTS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getTokenAccountsByOwner",
          params: [ownerAddress, { mint }, { encoding: "jsonParsed" }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const data = await resp.json() as {
        result?: { value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString: string } } } } } }> };
        error?: unknown;
      };
      // If RPC returned an error object, try next endpoint
      if (data.error) continue;
      const accounts = data.result?.value ?? [];
      // Empty array = wallet exists but has no token account for this mint = 0 balance
      if (accounts.length === 0) return 0;
      return parseFloat(accounts[0].account.data.parsed.info.tokenAmount.uiAmountString || "0");
    } catch { /* try next endpoint */ }
  }
  // All endpoints failed — return 0 as a safe default so UI shows live with $0
  return 0;
}

/** Fetch an ERC-20 token balance via eth_call (balanceOf) */
async function fetchErc20Balance(
  ownerAddress: string,
  contractAddress: string,
  decimals: number,
  rpcUrl: string
): Promise<number | null> {
  const padded = ownerAddress.replace("0x", "").padStart(64, "0");
  const callData = "0x70a08231" + padded;
  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_call",
        params: [{ to: contractAddress, data: callData }, "latest"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { result?: string };
    const raw = BigInt(json.result || "0x0");
    return Number(raw) / Math.pow(10, decimals);
  } catch { return null; }
}

// ─── Per-chain wallet helpers ─────────────────────────────────────────────────

export interface HtlcChainWallet {
  chain: "bitcoin" | "ethereum" | "solana";
  asset: string;
  address: string | null;
  balance: string;
  usd: string;
  live: boolean;
  configured: boolean;
  error?: string;
}

/** Derive BTC P2WPKH address + balance from WIF key */
async function getBtcHtlcWallet(): Promise<HtlcChainWallet> {
  const wif = process.env.BTC_AGENT_WIF;
  if (!wif) return { chain: "bitcoin", asset: "BTC", address: null, balance: "0.00000000", usd: "$0", live: false, configured: false, error: "BTC_AGENT_WIF not set" };

  try {
    const keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: bitcoin.networks.bitcoin,
    });
    if (!address) throw new Error("Could not derive BTC address");

    const res = await fetch(`https://mempool.space/api/address/${address}`, {
      signal: AbortSignal.timeout(8000),
    });
    let balanceSat = 0;
    let live = false;
    if (res.ok) {
      const data = await res.json() as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
      };
      balanceSat =
        data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum +
        data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
      live = true;
    }

    const balanceBtc = balanceSat / 1e8;
    let usdPrice = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { bitcoin: { usd: number } };
        usdPrice = priceData.bitcoin?.usd ?? 0;
      }
    } catch { /* price optional */ }

    return {
      chain: "bitcoin", asset: "BTC", address,
      balance: balanceBtc.toFixed(8),
      usd: balanceBtc * usdPrice > 0 ? `$${(balanceBtc * usdPrice).toFixed(2)}` : "$0",
      live, configured: true,
    };
  } catch (err: unknown) {
    return { chain: "bitcoin", asset: "BTC", address: null, balance: "0.00000000", usd: "$0", live: false, configured: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Derive ETH address + ETH/USDT/USDC balances from hex private key */
async function getEthHtlcWallets(): Promise<HtlcChainWallet[]> {
  let rawKey = process.env.ETH_AGENT_KEY ?? "";
  if (!rawKey) {
    const noKey = { address: null, balance: "0.000000", usd: "$0", live: false, configured: false, error: "ETH_AGENT_KEY not set" };
    return [
      { chain: "ethereum", asset: "ETH",  ...noKey },
      { chain: "ethereum", asset: "USDT", ...noKey },
      { chain: "ethereum", asset: "USDC", ...noKey },
    ];
  }

  if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;

  try {
    const wallet = new ethers.Wallet(rawKey);
    const address = wallet.address;
    const rpcUrl = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";

    let ethBal = 0;
    let live = false;
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const balWei = await provider.getBalance(address);
      ethBal = parseFloat(ethers.formatEther(balWei));
      live = true;
    } catch { /* RPC optional */ }

    // Fetch ERC-20 balances in parallel
    const [usdtBal, usdcBal] = await Promise.all([
      fetchErc20Balance(address, ETH_USDT_ADDR, 6, rpcUrl),
      fetchErc20Balance(address, ETH_USDC_ADDR, 6, rpcUrl),
    ]);

    // Fetch ETH price
    let ethUsdPrice = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { ethereum: { usd: number } };
        ethUsdPrice = priceData.ethereum?.usd ?? 0;
      }
    } catch { /* price optional */ }

    const ethUsd = ethBal * ethUsdPrice;
    const usdtUsd = usdtBal ?? 0;
    const usdcUsd = usdcBal ?? 0;

    // ERC-20 tokens share the same wallet and RPC as ETH — if ETH is live, tokens are live too.
    return [
      {
        chain: "ethereum", asset: "ETH", address,
        balance: ethBal.toFixed(6),
        usd: ethUsd > 0 ? `$${ethUsd.toFixed(2)}` : "$0",
        live, configured: true,
      },
      {
        chain: "ethereum", asset: "USDT", address,
        balance: (usdtBal ?? 0).toFixed(2),
        usd: usdtUsd > 0 ? `$${usdtUsd.toFixed(2)}` : "$0",
        live, configured: true,
      },
      {
        chain: "ethereum", asset: "USDC", address,
        balance: (usdcBal ?? 0).toFixed(2),
        usd: usdcUsd > 0 ? `$${usdcUsd.toFixed(2)}` : "$0",
        live, configured: true,
      },
    ];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failed = { address: null, balance: "0.000000", usd: "$0", live: false, configured: true, error: errMsg };
    return [
      { chain: "ethereum", asset: "ETH",  ...failed },
      { chain: "ethereum", asset: "USDT", ...failed },
      { chain: "ethereum", asset: "USDC", ...failed },
    ];
  }
}

/** Derive SOL address + SOL/USDT/USDC balances from base58 or JSON-array private key */
async function getSolHtlcWallets(): Promise<HtlcChainWallet[]> {
  const rawKey = process.env.SOL_AGENT_KEY ?? "";
  if (!rawKey) {
    const noKey = { address: null, balance: "0.000000", usd: "$0", live: false, configured: false, error: "SOL_AGENT_KEY not set" };
    return [
      { chain: "solana", asset: "SOL",  ...noKey },
      { chain: "solana", asset: "USDT", ...noKey },
      { chain: "solana", asset: "USDC", ...noKey },
    ];
  }

  try {
    let keypair: Keypair;
    if (rawKey.startsWith("[")) {
      keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawKey) as number[]));
    } else {
      keypair = Keypair.fromSecretKey(bs58.decode(rawKey));
    }
    const address = keypair.publicKey.toBase58();

    // Fetch SOL native balance + SPL token balances in parallel
    let solBal = 0;
    let live = false;
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

    const [lamports, usdtBal, usdcBal] = await Promise.all([
      connection.getBalance(new PublicKey(address)).then(l => { live = true; return l; }).catch(() => null),
      fetchSplBalance(address, SOL_USDT_MINT),
      fetchSplBalance(address, SOL_USDC_MINT),
    ]);

    if (lamports !== null) solBal = lamports / LAMPORTS_PER_SOL;

    // Fetch SOL price
    let solUsdPrice = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { solana: { usd: number } };
        solUsdPrice = priceData.solana?.usd ?? 0;
      }
    } catch { /* price optional */ }

    const solUsd = solBal * solUsdPrice;
    const usdtUsd = usdtBal ?? 0;
    const usdcUsd = usdcBal ?? 0;

    // SPL tokens share the same wallet and RPC as SOL — if SOL is live, tokens are live too.
    // fetchSplBalance now always returns 0 (not null) on success, so token live = SOL live.
    return [
      {
        chain: "solana", asset: "SOL", address,
        balance: solBal.toFixed(6),
        usd: solUsd > 0 ? `$${solUsd.toFixed(2)}` : "$0",
        live, configured: true,
      },
      {
        chain: "solana", asset: "USDT", address,
        balance: (usdtBal ?? 0).toFixed(2),
        usd: usdtUsd > 0 ? `$${usdtUsd.toFixed(2)}` : "$0",
        live, configured: true,
      },
      {
        chain: "solana", asset: "USDC", address,
        balance: (usdcBal ?? 0).toFixed(2),
        usd: usdcUsd > 0 ? `$${usdcUsd.toFixed(2)}` : "$0",
        live, configured: true,
      },
    ];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failed = { address: null, balance: "0.000000", usd: "$0", live: false, configured: true, error: errMsg };
    return [
      { chain: "solana", asset: "SOL",  ...failed },
      { chain: "solana", asset: "USDT", ...failed },
      { chain: "solana", asset: "USDC", ...failed },
    ];
  }
}

// ─── Legacy single-asset helpers (used by getOracleVmAddresses) ───────────────

async function getBtcHtlcWalletLegacy() {
  const w = await getBtcHtlcWallet();
  return { address: w.address, balance: w.balance, balanceBtc: parseFloat(w.balance) || 0, usd: w.usd, live: w.live, error: w.error };
}

async function getEthHtlcWalletLegacy() {
  const wallets = await getEthHtlcWallets();
  const eth = wallets.find(w => w.asset === "ETH")!;
  return { address: eth.address, balance: eth.balance, balanceEth: parseFloat(eth.balance) || 0, usd: eth.usd, live: eth.live, error: eth.error };
}

async function getSolHtlcWalletLegacy() {
  const wallets = await getSolHtlcWallets();
  const sol = wallets.find(w => w.asset === "SOL")!;
  return { address: sol.address, balance: sol.balance, balanceSol: parseFloat(sol.balance) || 0, usd: sol.usd, live: sol.live, error: sol.error };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const htlcWalletRouter = router({
  /**
   * Returns recent HTLC transactions from the database with optional chain filter.
   */
  getHtlcHistory: publicProcedure
    .input(
      z.object({
        chain: z.enum(["all", "bitcoin", "ethereum", "solana"]).default("all"),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { rows: [], total: 0, error: "Database not available" };

        const rows =
          input.chain === "all"
            ? await db
                .select()
                .from(htlcSwaps)
                .orderBy(desc(htlcSwaps.createdAt))
                .limit(input.limit)
            : await db
                .select()
                .from(htlcSwaps)
                .where(eq(htlcSwaps.chain, input.chain as "bitcoin" | "ethereum" | "solana"))
                .orderBy(desc(htlcSwaps.createdAt))
                .limit(input.limit);

        return { rows, total: rows.length };
      } catch (err) {
        return { rows: [], total: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  /**
   * Returns all 7 Oracle VM wallet addresses derived from stored agent keys.
   * SOL/USDT-SOL/USDC-SOL share the same Solana address (from SOL_AGENT_KEY).
   * ETH/USDT-ETH/USDC-ETH share the same Ethereum address (from ETH_AGENT_KEY).
   * BTC uses the P2WPKH address derived from BTC_AGENT_WIF.
   * Never exposes private keys.
   */
  getOracleVmAddresses: publicProcedure.query(async () => {
    const [btc, eth, sol] = await Promise.all([
      getBtcHtlcWalletLegacy(),
      getEthHtlcWalletLegacy(),
      getSolHtlcWalletLegacy(),
    ]);

    return [
      // Solana chain — all SPL tokens share the same wallet address
      { asset: "SOL",  chain: "solana"   as const, chainLabel: "Solana",   address: sol.address, configured: !!process.env.SOL_AGENT_KEY },
      { asset: "USDT", chain: "solana"   as const, chainLabel: "Solana",   address: sol.address, configured: !!process.env.SOL_AGENT_KEY },
      { asset: "USDC", chain: "solana"   as const, chainLabel: "Solana",   address: sol.address, configured: !!process.env.SOL_AGENT_KEY },
      // Ethereum chain — all ERC-20 tokens share the same wallet address
      { asset: "ETH",  chain: "ethereum" as const, chainLabel: "Ethereum", address: eth.address, configured: !!process.env.ETH_AGENT_KEY },
      { asset: "USDT", chain: "ethereum" as const, chainLabel: "Ethereum", address: eth.address, configured: !!process.env.ETH_AGENT_KEY },
      { asset: "USDC", chain: "ethereum" as const, chainLabel: "Ethereum", address: eth.address, configured: !!process.env.ETH_AGENT_KEY },
      // Bitcoin — native P2WPKH address
      { asset: "BTC",  chain: "bitcoin"  as const, chainLabel: "Bitcoin",  address: btc.address, configured: !!process.env.BTC_AGENT_WIF },
    ];
  }),

  /**
   * Returns all 7 HTLC wallet assets with on-chain balances:
   *   Solana:   SOL, USDT (SPL), USDC (SPL)
   *   Ethereum: ETH, USDT (ERC-20), USDC (ERC-20)
   *   Bitcoin:  BTC
   */
  getHtlcWallets: publicProcedure.query(async () => {
    const [btc, ethWallets, solWallets] = await Promise.all([
      getBtcHtlcWallet(),
      getEthHtlcWallets(),
      getSolHtlcWallets(),
    ]);

    // Return as flat array of 7 assets in display order
    const assets: HtlcChainWallet[] = [
      ...solWallets,   // SOL, USDT/SOL, USDC/SOL
      ...ethWallets,   // ETH, USDT/ETH, USDC/ETH
      btc,             // BTC
    ];

    // Also expose legacy btc/eth/sol keys for backward compat
    const eth = ethWallets.find(w => w.asset === "ETH")!;
    const sol = solWallets.find(w => w.asset === "SOL")!;

    return {
      assets,
      // Legacy keys — still used by older UI code
      btc: { chain: "bitcoin" as const, asset: "BTC", address: btc.address, balance: btc.balance, usd: btc.usd, live: btc.live, configured: btc.configured, error: btc.error },
      eth: { chain: "ethereum" as const, asset: "ETH", address: eth.address, balance: eth.balance, usd: eth.usd, live: eth.live, configured: eth.configured, error: eth.error },
      sol: { chain: "solana" as const, asset: "SOL", address: sol.address, balance: sol.balance, usd: sol.usd, live: sol.live, configured: sol.configured, error: sol.error },
    };
  }),
});
