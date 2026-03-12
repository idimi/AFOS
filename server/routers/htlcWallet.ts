/**
 * HTLC Wallet Router — Derives HTLC signing addresses from stored HTLC escrow keys
 * and fetches their on-chain balances across all 7 supported assets:
 *   Solana:   SOL, USDT (SPL), USDC (SPL)
 *   Ethereum: ETH, USDT (ERC-20), USDC (ERC-20)
 *   Bitcoin:  BTC
 *
 * HTLC Escrow Keys (dedicated to atomic swap lock/claim/refund):
 *   BTC_HTLC_WIF  — Bitcoin WIF private key for HTLC escrow
 *   ETH_HTLC_KEY  — Ethereum hex private key for HTLC escrow
 *   SOL_HTLC_KEY  — Solana base58 private key for HTLC escrow
 *
 * Fee Collection Keys (Oracle VM Hot Wallet — separate from escrow):
 *   BTC_AGENT_WIF  — Bitcoin WIF private key (fee wallet)
 *   ETH_AGENT_KEY  — Ethereum hex private key (fee wallet)
 *   SOL_AGENT_KEY  — Solana base58 private key (fee wallet)
 */

import { publicProcedure, router } from "../_core/trpc";
import { getCachedPrices } from "../priceCache";
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
import type { SupportedChain } from "@shared/const";

const ECPair = ECPairFactory(tinysecp);

// ─── Token constants ──────────────────────────────────────────────────────────

const SOL_USDT_MINT   = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL_USDC_MINT   = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ETH_USDT_ADDR   = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const ETH_USDC_ADDR   = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// ─── Solana RPC pool (free public endpoints, tried in parallel) ───────────────

/**
 * Solana RPC endpoints, ordered by priority.
 * Helius (authenticated) is first when HELIUS_API_KEY is set — 100k req/day free tier,
 * much higher rate limits than public endpoints.
 * Falls back to free public endpoints if Helius key is not configured.
 */
function buildSolRpcEndpoints(): string[] {
  const heliusKey = process.env.HELIUS_API_KEY;
  const endpoints: string[] = [];

  // Primary: Helius authenticated (highest rate limits)
  if (heliusKey) {
    endpoints.push(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`);
  }

  // Secondary: other free public endpoints as fallbacks
  endpoints.push(
    "https://api.mainnet-beta.solana.com",     // Official (rate-limited)
    "https://rpc.ankr.com/solana",             // Ankr free tier
    "https://solana-mainnet.rpc.extrnode.com", // Extrnode public
  );

  return endpoints;
}

const SOL_RPC_ENDPOINTS = buildSolRpcEndpoints();

// ─── Stale-while-revalidate balance cache ─────────────────────────────────────

interface SolBalanceCacheEntry {
  solBalance: number;
  usdtBalance: number;
  usdcBalance: number;
  fetchedAt: number; // ms timestamp
}

/** In-memory cache: address → last-known-good balance */
const _solBalanceCache = new Map<string, SolBalanceCacheEntry>();
const SOL_BALANCE_CACHE_TTL_MS = 30_000; // 30 seconds — fresh enough for UI

/**
 * Race multiple Solana RPC endpoints in parallel and return the first
 * successful SOL balance. Falls back to 0 if all fail.
 */
async function fetchSolBalanceRace(address: string): Promise<{ solBal: number; live: boolean }> {
  const racePromises = SOL_RPC_ENDPOINTS.map(async (rpc) => {
    const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });
    const lamports = await connection.getBalance(new PublicKey(address), "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  });

  // Race with a 6-second timeout per attempt
  const withTimeout = racePromises.map(p =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))])
  );

  // Use Promise.any to take the first success
  try {
    const solBal = await Promise.any(withTimeout as Promise<number>[]);
    return { solBal, live: true };
  } catch {
    return { solBal: 0, live: false };
  }
}

// ─── Shared fetch helpers ─────────────────────────────────────────────────────

/** Fetch an SPL token balance for a given owner address and mint.
 * Returns 0 when the wallet has no token account for this mint (unfunded).
 * Returns null only if the RPC itself is unreachable.
 */
async function fetchSplBalance(ownerAddress: string, mint: string): Promise<number | null> {
  for (const rpc of SOL_RPC_ENDPOINTS) {
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
  chain: SupportedChain;
  asset: string;
  address: string | null;
  balance: string;
  usd: string;
  live: boolean;
  configured: boolean;
  error?: string;
}

/** Derive BTC P2WPKH address + balance from HTLC WIF key */
async function getBtcHtlcWallet(): Promise<HtlcChainWallet> {
  const wif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF; // fallback to agent key if HTLC key not set
  if (!wif) return { chain: "bitcoin", asset: "BTC", address: null, balance: "0.00000000", usd: "$0", live: false, configured: false, error: "BTC_HTLC_WIF not set" };

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

/** Derive ETH address + ETH/USDT/USDC balances from HTLC hex private key */
async function getEthHtlcWallets(): Promise<HtlcChainWallet[]> {
  let rawKey = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY ?? ""; // fallback to agent key if HTLC key not set
  if (!rawKey) {
    const noKey = { address: null, balance: "0.000000", usd: "$0", live: false, configured: false, error: "ETH_HTLC_KEY not set" };
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

/** Derive SOL address + SOL/USDT/USDC balances from HTLC base58 private key */
async function getSolHtlcWallets(): Promise<HtlcChainWallet[]> {
  const rawKey = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY ?? ""; // fallback to agent key if HTLC key not set
  if (!rawKey) {
    const noKey = { address: null, balance: "0.000000", usd: "$0", live: false, configured: false, error: "SOL_HTLC_KEY not set" };
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

    // Fetch SOL native balance + SPL token balances in parallel (race all RPC endpoints)
    const [{ solBal, live }, usdtBal, usdcBal] = await Promise.all([
      fetchSolBalanceRace(address),
      fetchSplBalance(address, SOL_USDT_MINT),
      fetchSplBalance(address, SOL_USDC_MINT),
    ]);

    // Use shared cached price (avoids extra CoinGecko call)
    const solUsdPrice = getCachedPrices().sol;

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

// ─── TNK Escrow Wallet (agent-escrow model, no private key) ─────────────────────

// Correct Trac Network RPC API — explorer.trac.network/api returns 404 for address endpoints
// Use: GET https://tracapi.trac.network/v1/balance/{address} → { address, balance: number }
const TRAC_RPC_API = "https://tracapi.trac.network/v1";

/**
 * Fetch the TNK HTLC wallet balance.
 * Priority order for address resolution:
 *   1. TNK_HTLC_WIF  — derive P2WPKH address from the HTLC signing key (live signing wallet)
 *   2. TNK_ESCROW_ADDRESS — shared agent-escrow address (read-only fallback)
 * Balance is fetched from the Trac Network RPC API (tracapi.trac.network).
 */
async function getTnkEscrowWallet(): Promise<HtlcChainWallet> {
  // Prefer the HTLC signing key address when available
  let address = process.env.TNK_ESCROW_ADDRESS ?? "";
  let addressSource: "htlc_wif" | "escrow_address" | "none" = address ? "escrow_address" : "none";

  const tnkHtlcWif = process.env.TNK_HTLC_WIF;
  if (tnkHtlcWif) {
    try {
      // TNK uses Bitcoin-compatible P2WPKH addressing (Trac Network is a Bitcoin meta-protocol)
      const keyPair = ECPair.fromWIF(tnkHtlcWif);
      const { address: derived } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey) });
      if (derived) {
        address = derived;
        addressSource = "htlc_wif";
      }
    } catch {
      // WIF may not be a standard Bitcoin WIF (e.g. raw hex key) — fall back to escrow address
    }
  }

  const configured = !!tnkHtlcWif || !!process.env.TNK_ESCROW_ADDRESS;
  if (!address || address.includes("placeholder")) {
    return {
      chain: "trac_network",
      asset: "TNK",
      address: address || null,
      balance: "0.00",
      usd: "$0",
      live: false,
      configured,
      error: configured ? "Address derivation failed — check TNK_HTLC_WIF format" : "TNK_HTLC_WIF and TNK_ESCROW_ADDRESS not set",
    };
  }

  try {
    // Fetch balance from Trac Network RPC API
    // Endpoint: GET https://tracapi.trac.network/v1/balance/{address}
    // Response: { address: string, balance: number }
    // Note: explorer.trac.network/api returns 404 for address endpoints — use tracapi instead
    const res = await fetch(
      `${TRAC_RPC_API}/balance/${address}`,
      { signal: AbortSignal.timeout(8000) }
    );

    let balanceTnk = 0;
    let live = false;

    if (res.ok) {
      const data = await res.json() as { address?: string; balance?: number | string };
      const raw = data.balance ?? 0;
      balanceTnk = typeof raw === "string" ? parseFloat(raw) : (raw ?? 0);
      live = true; // API responded — wallet is live even if balance is 0
    }

    // Fetch TNK price from CoinGecko
    let tnkUsdPrice = 0;
    try {
      const priceRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=trac-network&vs_currencies=usd",
        { signal: AbortSignal.timeout(5000) }
      );
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { "trac-network"?: { usd?: number } };
        tnkUsdPrice = priceData["trac-network"]?.usd ?? 0;
      }
    } catch { /* price optional */ }

    const usdValue = balanceTnk * tnkUsdPrice;

    return {
      chain: "trac_network",
      asset: "TNK",
      address,
      balance: balanceTnk.toFixed(2),
      usd: usdValue > 0 ? `$${usdValue.toFixed(2)}` : "$0",
      live,
      configured,
      // Surface which key is being used so operators can verify in the UI
      error: addressSource === "htlc_wif" ? undefined : "Using TNK_ESCROW_ADDRESS (set TNK_HTLC_WIF for HTLC signing wallet)",
    };
  } catch (err: unknown) {
    return {
      chain: "trac_network",
      asset: "TNK",
      address,
      balance: "0.00",
      usd: "$0",
      live: false,
      configured,
      error: err instanceof Error ? err.message : String(err),
    };
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
   * Returns the HTLC escrow wallet address for a given chain.
   * Used by the frontend to know where to send funds during HTLC lock.
   * Does NOT expose private keys — only the derived public address.
   */
  getEscrowAddress: publicProcedure
    .input(z.object({ chain: z.enum(["solana", "ethereum", "bitcoin", "trac_network"]) }))
    .query(async ({ input }) => {
      const { chain } = input;
      try {
        if (chain === "solana") {
          const rawKey = process.env.SOL_HTLC_KEY ?? process.env.SOL_AGENT_KEY;
          if (!rawKey) return { address: null, configured: false };
          let keypair: import("@solana/web3.js").Keypair;
          if (rawKey.startsWith("[")) {
            keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawKey) as number[]));
          } else {
            keypair = Keypair.fromSecretKey(bs58.decode(rawKey));
          }
          return { address: keypair.publicKey.toBase58(), configured: true };
        } else if (chain === "ethereum") {
          let rawKey = process.env.ETH_HTLC_KEY ?? process.env.ETH_AGENT_KEY ?? "";
          if (!rawKey) return { address: null, configured: false };
          if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;
          const wallet = new ethers.Wallet(rawKey);
          return { address: wallet.address, configured: true };
        } else if (chain === "bitcoin") {
          const wif = process.env.BTC_HTLC_WIF ?? process.env.BTC_AGENT_WIF;
          if (!wif) return { address: null, configured: false };
          const keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
          const { address } = bitcoin.payments.p2wpkh({
            pubkey: Buffer.from(keyPair.publicKey),
            network: bitcoin.networks.bitcoin,
          });
          return { address: address ?? null, configured: true };
        } else if (chain === "trac_network") {
          const address = process.env.TNK_ESCROW_ADDRESS ?? null;
          return { address, configured: !!address };
        }
        return { address: null, configured: false };
      } catch {
        return { address: null, configured: false };
      }
    }),

  /**
   * Records an HTLC deposit after the user has sent funds to the escrow wallet.
   * Called by the frontend after a successful lock transaction.
   */
  recordHtlcDeposit: publicProcedure
    .input(z.object({
      chain: z.enum(["solana", "ethereum", "bitcoin", "trac_network"]),
      txHash: z.string(),
      senderAddress: z.string(),
      recipientAddress: z.string(),
      escrowAddress: z.string(),
      amountRaw: z.string(),
      token: z.string(),
      secretHash: z.string(),
      timelock: z.number(),
      rfqId: z.string().optional(),
      peerId: z.string().optional(),
      // Additional monitoring fields sent by the client
      htlcId: z.string().optional(),
      isAgentA: z.boolean().optional(),
      /**
       * The counterparty's wallet address on the same chain.
       * For Agent A: pass Agent B's wallet address (the recipient of Agent A's locked funds).
       * For Agent B: pass Agent A's wallet address (the initiator).
       * Stored so HtlcSecretsMonitor can resolve both addresses for auto-claim retries
       * without needing a separate htlc_secrets lookup.
       */
      counterpartyAddress: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        await db.insert(htlcSwaps).values({
          chain: input.chain as SupportedChain,
          lockTxId: input.txHash,
          senderAddress: input.senderAddress,
          recipientAddress: input.recipientAddress ?? null,
          htlcAddress: input.escrowAddress,
          htlcId: input.htlcId ?? null,
          amountRaw: input.amountRaw,
          amountHuman: input.amountRaw,
          toToken: input.token,
          secretHash: input.secretHash,
          locktime: input.timelock,
          status: "pending",
          rfqId: input.rfqId ?? null,
          peerId: input.peerId ?? null,
          counterpartyAddress: input.counterpartyAddress ?? null,
        });
        console.log(`[HTLC] Recorded deposit: ${input.chain} ${input.amountRaw} ${input.token} tx=${input.txHash}`);
        return { success: true };
      } catch (err) {
        console.error("[HTLC] Failed to record deposit:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  /**
   * Returns recent HTLC transactions from the database with optional chain filter.
   */
  getHtlcHistory: publicProcedure
    .input(
      z.object({
        chain: z.enum(["all", "bitcoin", "ethereum", "solana", "trac_network"]).default("all"),
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
                .where(eq(htlcSwaps.chain, input.chain as SupportedChain))
                .orderBy(desc(htlcSwaps.createdAt))
                .limit(input.limit);

        return { rows, total: rows.length };
      } catch (err) {
        return { rows: [], total: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  /**
   * Returns all 8 Oracle VM wallet addresses derived from stored agent keys.
   * SOL/USDT-SOL/USDC-SOL share the same Solana address (from SOL_AGENT_KEY).
   * ETH/USDT-ETH/USDC-ETH share the same Ethereum address (from ETH_AGENT_KEY).
   * BTC uses the P2WPKH address derived from BTC_AGENT_WIF.
   * TNK uses the TNK_ESCROW_ADDRESS env variable (Trac Network escrow).
   * Never exposes private keys.
   */
  getOracleVmAddresses: publicProcedure.query(async () => {
    const [btc, eth, sol] = await Promise.all([
      getBtcHtlcWalletLegacy(),
      getEthHtlcWalletLegacy(),
      getSolHtlcWalletLegacy(),
    ]);

    const tnkEscrowAddress = process.env.TNK_ESCROW_ADDRESS || null;

    return [
      // Solana chain — all SPL tokens share the same wallet address
      { asset: "SOL",  chain: "solana"       as const, chainLabel: "Solana",       address: sol.address,        configured: !!process.env.SOL_AGENT_KEY },
      { asset: "USDT", chain: "solana"       as const, chainLabel: "Solana",       address: sol.address,        configured: !!process.env.SOL_AGENT_KEY },
      { asset: "USDC", chain: "solana"       as const, chainLabel: "Solana",       address: sol.address,        configured: !!process.env.SOL_AGENT_KEY },
      // Ethereum chain — all ERC-20 tokens share the same fee wallet address
      { asset: "ETH",  chain: "ethereum"     as const, chainLabel: "Ethereum",     address: eth.address,        configured: !!process.env.ETH_AGENT_KEY },
      { asset: "USDT", chain: "ethereum"     as const, chainLabel: "Ethereum",     address: eth.address,        configured: !!process.env.ETH_AGENT_KEY },
      { asset: "USDC", chain: "ethereum"     as const, chainLabel: "Ethereum",     address: eth.address,        configured: !!process.env.ETH_AGENT_KEY },
      // Bitcoin — native P2WPKH fee wallet address
      { asset: "BTC",  chain: "bitcoin"      as const, chainLabel: "Bitcoin",      address: btc.address,        configured: !!process.env.BTC_AGENT_WIF },
      // Trac Network — TNK escrow address (read-only, not a signing key)
      { asset: "TNK",  chain: "trac_network" as const, chainLabel: "Trac Network", address: tnkEscrowAddress,   configured: !!tnkEscrowAddress },
    ];
  }),

  /**
   * Returns all 7 HTLC wallet assets with on-chain balances:
   *   Solana:   SOL, USDT (SPL), USDC (SPL)
   *   Ethereum: ETH, USDT (ERC-20), USDC (ERC-20)
   *   Bitcoin:  BTC
   */
  /**
   * Fetch SOL + SPL token balances for any Solana address.
   * Used by the frontend when Phantom connects via multi-chain flow
   * (bypassing the wallet adapter) and needs server-side RPC access.
   */
  getSolanaBalanceByAddress: publicProcedure
    .input(z.object({
      address: z.string().min(32).max(50),
      /**
       * Optional: on-chain mint address of an arbitrary SPL token to check.
       * When provided, the response includes `splBalance` for that specific mint.
       * Useful for pre-checking any SPL token balance before an HTLC lock.
       * USDT and USDC are always returned regardless of this field.
       */
      mint: z.string().min(32).max(50).optional(),
    }))
    .query(async ({ input }) => {
      const { address, mint } = input;
      const now = Date.now();
      const cached = _solBalanceCache.get(address);
      const cacheAge = cached ? now - cached.fetchedAt : Infinity;
      const cacheStale = cacheAge > SOL_BALANCE_CACHE_TTL_MS;

      // ── Stale-while-revalidate ──────────────────────────────────────────────
      // If we have a fresh cache entry AND no custom mint was requested, return
      // immediately (no RPC call). Custom mint queries always go live.
      if (cached && !cacheStale && !mint) {
        // Cache is fresh — return immediately
        const solUsdPrice = getCachedPrices().sol;
        const solUsd = cached.solBalance * solUsdPrice;
        return {
          address, live: true,
          solBalance: cached.solBalance, solUsd,
          usdtBalance: cached.usdtBalance, usdtUsd: cached.usdtBalance,
          usdcBalance: cached.usdcBalance, usdcUsd: cached.usdcBalance,
          totalUsd: solUsd + cached.usdtBalance + cached.usdcBalance,
          solUsdPrice, stale: false,
          splBalance: null,
        };
      }

      // Fetch fresh data — race all RPC endpoints in parallel.
      // If a custom mint was requested, fetch its balance alongside USDT/USDC.
      const [{ solBal, live }, usdtBal, usdcBal, splBal] = await Promise.all([
        fetchSolBalanceRace(address),
        fetchSplBalance(address, SOL_USDT_MINT),
        fetchSplBalance(address, SOL_USDC_MINT),
        // Only fetch the custom mint if provided; otherwise resolve null immediately
        mint ? fetchSplBalance(address, mint) : Promise.resolve(null),
      ]);

      // If RPC failed but we have stale cache, return stale data (never show $0 for a known wallet)
      const effectiveSolBal = live ? solBal : (cached?.solBalance ?? 0);
      const effectiveUsdtBal = (usdtBal !== null && usdtBal >= 0) ? usdtBal : (cached?.usdtBalance ?? 0);
      const effectiveUsdcBal = (usdcBal !== null && usdcBal >= 0) ? usdcBal : (cached?.usdcBalance ?? 0);
      const effectiveLive = live || !!cached; // "live" if we have any data

      // Update cache only when we got a real response (don't cache custom-mint queries
      // to avoid polluting the general-purpose cache entry)
      if (live && !mint) {
        _solBalanceCache.set(address, {
          solBalance: solBal,
          usdtBalance: usdtBal ?? 0,
          usdcBalance: usdcBal ?? 0,
          fetchedAt: now,
        });
      }

      const solUsdPrice = getCachedPrices().sol;
      const solUsd = effectiveSolBal * solUsdPrice;
      const usdtUsd = effectiveUsdtBal;
      const usdcUsd = effectiveUsdcBal;
      const totalUsd = solUsd + usdtUsd + usdcUsd;

      return {
        address,
        live: effectiveLive,
        solBalance: effectiveSolBal,
        solUsd,
        usdtBalance: effectiveUsdtBal,
        usdtUsd,
        usdcBalance: effectiveUsdcBal,
        usdcUsd,
        totalUsd,
        solUsdPrice,
        stale: !live && !!cached,
        /** Balance of the custom `mint` token, if requested. Null if not requested or fetch failed. */
        splBalance: splBal,
      };
    }),

  getHtlcWallets: publicProcedure.query(async () => {
    const [btc, ethWallets, solWallets, tnk] = await Promise.all([
      getBtcHtlcWallet(),
      getEthHtlcWallets(),
      getSolHtlcWallets(),
      getTnkEscrowWallet(),
    ]);

    // Return as flat array of 8 assets in display order
    const assets: HtlcChainWallet[] = [
      ...solWallets,   // SOL, USDT/SOL, USDC/SOL
      ...ethWallets,   // ETH, USDT/ETH, USDC/ETH
      btc,             // BTC
      tnk,             // TNK (agent-escrow)
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
      tnk: { chain: "trac_network" as const, asset: "TNK", address: tnk.address, balance: tnk.balance, usd: tnk.usd, live: tnk.live, configured: tnk.configured, error: tnk.error },
    };
  }),

  /**
   * Check if the Trac Network RPC is reachable (server-side, bypasses browser CORS).
   * Used by AdminPanel to determine TNK live status for the fee collection wallet.
   */
  checkTnkLive: publicProcedure.query(async () => {
    try {
      const res = await fetch('https://tracapi.trac.network/v1/confirmed-length', {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as { confirmed_length?: number };
        return { live: true, confirmedLength: data.confirmed_length ?? 0 };
      }
      return { live: false, confirmedLength: 0 };
    } catch {
      return { live: false, confirmedLength: 0 };
    }
  }),
});
