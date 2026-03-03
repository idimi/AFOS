/**
 * HTLC Wallet Router — Derives HTLC signing addresses from stored agent keys
 * and fetches their on-chain balances across BTC, ETH, and SOL.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive BTC P2WPKH address + balance from WIF key */
async function getBtcHtlcWallet(): Promise<{
  address: string | null;
  balance: string;
  balanceBtc: number;
  usd: string;
  live: boolean;
  error?: string;
}> {
  const wif = process.env.BTC_AGENT_WIF;
  if (!wif) return { address: null, balance: "0.00000000", balanceBtc: 0, usd: "$0", live: false, error: "BTC_AGENT_WIF not set" };

  try {
    const keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: bitcoin.networks.bitcoin,
    });
    if (!address) throw new Error("Could not derive BTC address");

    // Fetch balance from mempool.space
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

    // Fetch BTC price for USD estimate
    let usdPrice = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {
        signal: AbortSignal.timeout(5000),
      });
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { bitcoin: { usd: number } };
        usdPrice = priceData.bitcoin?.usd ?? 0;
      }
    } catch { /* price optional */ }

    const usdValue = balanceBtc * usdPrice;

    return {
      address,
      balance: balanceBtc.toFixed(8),
      balanceBtc,
      usd: usdValue > 0 ? `$${usdValue.toFixed(2)}` : "$0",
      live,
    };
  } catch (err: unknown) {
    return {
      address: null,
      balance: "0.00000000",
      balanceBtc: 0,
      usd: "$0",
      live: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Derive ETH address + balance from hex private key */
async function getEthHtlcWallet(): Promise<{
  address: string | null;
  balance: string;
  balanceEth: number;
  usd: string;
  live: boolean;
  error?: string;
}> {
  let rawKey = process.env.ETH_AGENT_KEY ?? "";
  if (!rawKey) return { address: null, balance: "0.000000", balanceEth: 0, usd: "$0", live: false, error: "ETH_AGENT_KEY not set" };

  // Normalise: ensure 0x prefix for ethers
  if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;

  try {
    const wallet = new ethers.Wallet(rawKey);
    const address = wallet.address;

    // Fetch balance via configured RPC (ETH_RPC_URL env var), falling back to Cloudflare
    const rpcUrl = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";
    let balanceEth = 0;
    let live = false;
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const balWei = await provider.getBalance(address);
      balanceEth = parseFloat(ethers.formatEther(balWei));
      live = true;
    } catch { /* RPC optional */ }

    // Fetch ETH price
    let usdPrice = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
        signal: AbortSignal.timeout(5000),
      });
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { ethereum: { usd: number } };
        usdPrice = priceData.ethereum?.usd ?? 0;
      }
    } catch { /* price optional */ }

    const usdValue = balanceEth * usdPrice;

    return {
      address,
      balance: balanceEth.toFixed(6),
      balanceEth,
      usd: usdValue > 0 ? `$${usdValue.toFixed(2)}` : "$0",
      live,
    };
  } catch (err: unknown) {
    return {
      address: null,
      balance: "0.000000",
      balanceEth: 0,
      usd: "$0",
      live: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Derive SOL address + balance from base58 or JSON-array private key */
async function getSolHtlcWallet(): Promise<{
  address: string | null;
  balance: string;
  balanceSol: number;
  usd: string;
  live: boolean;
  error?: string;
}> {
  const rawKey = process.env.SOL_AGENT_KEY ?? "";
  if (!rawKey) return { address: null, balance: "0.000000", balanceSol: 0, usd: "$0", live: false, error: "SOL_AGENT_KEY not set" };

  try {
    let keypair: Keypair;
    if (rawKey.startsWith("[")) {
      // JSON array of 64 bytes
      const arr = JSON.parse(rawKey) as number[];
      keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
    } else {
      // base58 encoded
      keypair = Keypair.fromSecretKey(bs58.decode(rawKey));
    }

    const address = keypair.publicKey.toBase58();

    // Fetch balance via Solana mainnet RPC
    let balanceSol = 0;
    let live = false;
    try {
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const lamports = await connection.getBalance(new PublicKey(address));
      balanceSol = lamports / LAMPORTS_PER_SOL;
      live = true;
    } catch { /* RPC optional */ }

    // Fetch SOL price
    let usdPrice = 0;
    try {
      const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
        signal: AbortSignal.timeout(5000),
      });
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { solana: { usd: number } };
        usdPrice = priceData.solana?.usd ?? 0;
      }
    } catch { /* price optional */ }

    const usdValue = balanceSol * usdPrice;

    return {
      address,
      balance: balanceSol.toFixed(6),
      balanceSol,
      usd: usdValue > 0 ? `$${usdValue.toFixed(2)}` : "$0",
      live,
    };
  } catch (err: unknown) {
    return {
      address: null,
      balance: "0.000000",
      balanceSol: 0,
      usd: "$0",
      live: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const htlcWalletRouter = router({
  /**
   * Returns derived HTLC wallet addresses and on-chain balances for BTC, ETH, SOL.
   * Reads keys from environment variables — never exposes private keys.
   */
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
      getBtcHtlcWallet(),
      getEthHtlcWallet(),
      getSolHtlcWallet(),
    ]);

    return [
      // Solana chain — all SPL tokens share the same wallet address
      { asset: 'SOL',  chain: 'solana'   as const, chainLabel: 'Solana',   address: sol.address, configured: !!process.env.SOL_AGENT_KEY },
      { asset: 'USDT', chain: 'solana'   as const, chainLabel: 'Solana',   address: sol.address, configured: !!process.env.SOL_AGENT_KEY },
      { asset: 'USDC', chain: 'solana'   as const, chainLabel: 'Solana',   address: sol.address, configured: !!process.env.SOL_AGENT_KEY },
      // Ethereum chain — all ERC-20 tokens share the same wallet address
      { asset: 'ETH',  chain: 'ethereum' as const, chainLabel: 'Ethereum', address: eth.address, configured: !!process.env.ETH_AGENT_KEY },
      { asset: 'USDT', chain: 'ethereum' as const, chainLabel: 'Ethereum', address: eth.address, configured: !!process.env.ETH_AGENT_KEY },
      { asset: 'USDC', chain: 'ethereum' as const, chainLabel: 'Ethereum', address: eth.address, configured: !!process.env.ETH_AGENT_KEY },
      // Bitcoin — native P2WPKH address
      { asset: 'BTC',  chain: 'bitcoin'  as const, chainLabel: 'Bitcoin',  address: btc.address, configured: !!process.env.BTC_AGENT_WIF },
    ];
  }),

  getHtlcWallets: publicProcedure.query(async () => {
    const [btc, eth, sol] = await Promise.all([
      getBtcHtlcWallet(),
      getEthHtlcWallet(),
      getSolHtlcWallet(),
    ]);

    return {
      btc: {
        chain: "bitcoin" as const,
        asset: "BTC",
        address: btc.address,
        balance: btc.balance,
        usd: btc.usd,
        live: btc.live,
        configured: !!process.env.BTC_AGENT_WIF,
        error: btc.error,
      },
      eth: {
        chain: "ethereum" as const,
        asset: "ETH",
        address: eth.address,
        balance: eth.balance,
        usd: eth.usd,
        live: eth.live,
        configured: !!process.env.ETH_AGENT_KEY,
        error: eth.error,
      },
      sol: {
        chain: "solana" as const,
        asset: "SOL",
        address: sol.address,
        balance: sol.balance,
        usd: sol.usd,
        live: sol.live,
        configured: !!process.env.SOL_AGENT_KEY,
        error: sol.error,
      },
    };
  }),
});
