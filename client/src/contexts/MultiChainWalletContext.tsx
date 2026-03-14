/**
 * MultiChainWalletContext
 * Manages wallet connections for four chains:
 *   - Solana:        Phantom (window.phantom.solana) or MetaMask (window.ethereum)
 *   - Ethereum:      Phantom (window.phantom.ethereum) or MetaMask (window.ethereum EIP-1193)
 *   - Bitcoin:       Phantom (window.phantom.bitcoin), MetaMask CAIP-25, or Tap Wallet (window.tapprotocol)
 *   - Trac Network:  Tap Wallet only (window.tracnetwork)
 *
 * Conflict-free namespace isolation:
 *   Phantom  → always reads from window.phantom.* (never window.bitcoin)
 *   MetaMask → EIP-1193 window.ethereum + CAIP-25 bip122 scope for BTC
 *   Tap Wallet → window.tapprotocol (BTC) + window.tracnetwork (TNK) — never touches window.bitcoin
 *
 * Removed: Solflare, Coinbase Wallet, Xverse (not supported in AFOS 3-wallet architecture)
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { toast } from "sonner";
import { showWalletConnectedToast, showWalletDisconnectedToast, showBtcWalletSwitchedToast } from "../components/ConnectWalletModal";
import type { SupportedChain } from "@shared/const";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Chain = SupportedChain;
export type EthProviderType = "metamask" | "phantom";
export type BtcProviderType = "metamask" | "tap" | "phantom";

export interface ChainWallet {
  chain: Chain;
  walletName: string;
  address: string;
  shortAddress: string;
  balance: string;       // human-readable amount
  balanceUsd: number;
  symbol: string;        // SOL / ETH / BTC / TNK
  connected: boolean;
  connecting: boolean;
  /** Whether this connection came from Phantom multi-chain */
  isPhantom?: boolean;
}

export interface EthErc20Balances {
  usdc: number;   // USDC balance in human units (6 decimals)
  usdt: number;   // USDT balance in human units (6 decimals)
}

/** Phantom multi-chain connection state */
export interface PhantomMultiChainState {
  /** Whether Phantom is connected across all available chains */
  connected: boolean;
  /** Which chains Phantom successfully connected */
  chains: Chain[];
  /** Phantom's Solana address (if connected) */
  solanaAddress?: string;
  /** Phantom's Ethereum address (if connected) */
  ethereumAddress?: string;
  /** Phantom's Bitcoin payment address (if connected) */
  bitcoinAddress?: string;
  /** Solana balances fetched via RPC (SOL + SPL tokens) */
  solanaBalances?: Array<{ symbol: string; amount: string; usdValue: number }>;
  /** Total USD value of Solana holdings */
  solanaTotalUsd?: number;
}

interface MultiChainWalletContextValue {
  ethereum: ChainWallet | null;
  /** Active BTC wallet — respects preferredBtcWallet when both Phantom/MetaMask and Tap Wallet are connected */
  bitcoin: ChainWallet | null;
  /** Tap Wallet BTC state — kept separate so Phantom/MetaMask BTC and Tap Wallet BTC can coexist */
  bitcoinTap: ChainWallet | null;
  /** Which BTC wallet to prefer when multiple are connected. null = use last-connected */
  preferredBtcWallet: BtcProviderType | null;
  /** Explicitly choose which BTC wallet to use for the next swap */
  setPreferredBtcWallet: (provider: BtcProviderType | null) => void;
  /** Trac Network (TNK) wallet state — connected via window.tracnetwork (Tap Wallet) */
  tracNetwork: ChainWallet | null;
  erc20Balances: EthErc20Balances;
  /** Phantom multi-chain state — non-null when Phantom is connected */
  phantomMultiChain: PhantomMultiChainState | null;
  connectEthereum: (provider: EthProviderType) => Promise<void>;
  connectBitcoin: (provider: BtcProviderType) => Promise<void>;
  /** Connect Phantom across all supported chains at once */
  connectPhantomMultiChain: () => Promise<void>;
  disconnectEthereum: () => void;
  disconnectBitcoin: () => void;
  disconnectPhantom: () => void;
  /** Disconnect Trac Network (TNK) wallet connected via Tap Wallet */
  disconnectTracNetwork: () => void;
  /** Manually refresh Solana balances for Phantom multi-chain connection */
  refreshPhantomSolBalance: () => Promise<void>;
  ethConnecting: boolean;
  btcConnecting: boolean;
  phantomConnecting: boolean;
  /**
   * Unified BTC PSBT signing helper — auto-routes to whichever wallet is connected.
   * Supports: Phantom, Tap Wallet (window.tapprotocol), MetaMask (Bitcoin Snap). Xverse removed.
   * @param psbtBase64 - Base64-encoded PSBT string
   * @param inputsToSign - Array of input indices to sign
   * @returns Signed PSBT as base64 string
   */
  btcSignPsbt: (psbtBase64: string, inputsToSign?: number[]) => Promise<string>;
}

const MultiChainWalletContext = createContext<MultiChainWalletContextValue | null>(null);

export function useMultiChainWallet() {
  const ctx = useContext(MultiChainWalletContext);
  if (!ctx) throw new Error("useMultiChainWallet must be inside MultiChainWalletProvider");
  return ctx;
}

// ─── ERC-20 contract addresses (Ethereum mainnet) ────────────────────────────
const ERC20_CONTRACTS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
} as const;

// ERC-20 balanceOf(address) selector = keccak256("balanceOf(address)")[0:4] = 0x70a08231
function encodeBalanceOf(address: string): string {
  const addr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  return `0x70a08231${addr}`;
}

async function fetchErc20Balance(
  provider: EthProvider,
  tokenAddress: string,
  walletAddress: string,
  decimals: number
): Promise<number> {
  try {
    const result = await provider.request({
      method: "eth_call",
      params: [{ to: tokenAddress, data: encodeBalanceOf(walletAddress) }, "latest"],
    }) as string;
    if (!result || result === "0x") return 0;
    return parseInt(result, 16) / Math.pow(10, decimals);
  } catch {
    return 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface EthProvider {
  isMetaMask?: boolean;
  providers?: EthProvider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
}

type EthWindowProvider = EthProvider;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
    /** Tap Wallet Bitcoin provider — exposes BTC address and signing */
    tapprotocol?: {
      requestAccounts: () => Promise<string[]>;
      getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number } | string>;
      sendBitcoin: (to: string, satoshis: number) => Promise<{ txHash: string }>;
      signPsbt: (psbtHex: string, options?: { autoFinalized?: boolean; toSignInputs?: { index: number; address?: string; publicKey?: string; sighashTypes?: number[] }[] }) => Promise<string>;
      getPublicKey: () => Promise<string>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      off?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
    /** Tap Wallet Trac Network provider — exposes TNK address and signing */
    tracnetwork?: {
      requestAccount: () => Promise<string>;
      getAddress: () => Promise<string>;
      getBalance: () => Promise<string>;
      getNetwork: () => Promise<string>;
      switchNetwork: (network: string) => Promise<string>;
      getPublicKey: () => Promise<string>;
      signMessage: (message: string) => Promise<{ signature: string; publicKey: string; address: string }>;
      sendTNK: (from: string, to: string, amount: string) => Promise<{ txHash: string; success: boolean }>;
      buildTracTx: (params: { from?: string; to: string; amount: string | number }) => Promise<string>;
      pushTracTx: (txPayload: string) => Promise<{ txHash: string; success: boolean }>;
      signTracTx: (contractTx: unknown) => Promise<{ tx: string; signature: string }>;
      signPsbt?: (psbtHex: string) => Promise<string>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      off?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
    // Xverse removed — not supported in AFOS 3-wallet architecture
    phantom?: {
      solana?: {
        isPhantom?: boolean;
        connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
        disconnect: () => Promise<void>;
        publicKey?: { toString(): string };
      };
      ethereum?: EthProvider & { isPhantom?: boolean };
      bitcoin?: {
        isPhantom?: boolean;
        requestAccounts: () => Promise<{ address: string; addressType: string; publicKey: string; purpose: string }[]>;
        signPSBT: (psbt: Uint8Array, opts?: unknown) => Promise<Uint8Array>;
      };
    };
  }
}

  // Pick the right EIP-1193 provider from window.ethereum (handles multi-wallet injection)
function getEthProvider(type: EthProviderType): EthProvider | null {
  // Phantom has its own ethereum provider
  if (type === "phantom") {
    return window.phantom?.ethereum ?? null;
  }
  // MetaMask: prefer the MetaMask provider when multiple wallets inject into window.ethereum
  const eth = window.ethereum as EthWindowProvider | undefined;
  if (!eth) return null;
  if (eth.providers) {
    return eth.providers.find((p: EthProvider) => p.isMetaMask) ?? eth.providers[0] ?? null;
  }
  return eth;
}

async function fetchEthPriceUsd(): Promise<number> {
  try {
    return await withRetry(async () => {
      const res = await fetch("/api/afos/api/prices");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const price = data.prices?.ETH?.usd || data.prices?.eth?.usd || 0;
      if (price <= 0) throw new Error("ETH price is 0");
      return price;
    }, 2, 1500, "ETH price");
  } catch (_) {
    return 0;
  }
}

async function fetchBtcBalanceFromMempool(address: string): Promise<{ btc: string; sats: number } | null> {
  try {
    return await withRetry(async () => {
      const res = await fetch(`https://mempool.space/api/address/${address}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sats: number =
        (data.chain_stats?.funded_txo_sum ?? 0) -
        (data.chain_stats?.spent_txo_sum ?? 0);
      const btc = (sats / 1e8).toFixed(8);
      return { btc, sats };
    }, 2, 2000, "BTC balance");
  } catch (err) {
    console.warn("[Mempool] BTC balance fetch failed after retries:", err);
    return null; // Return null so callers can preserve last-known-good values
  }
}

async function fetchBtcPriceUsd(): Promise<number> {
  try {
    return await withRetry(async () => {
      const res = await fetch("/api/afos/api/prices");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const price = data.prices?.BTC?.usd || data.prices?.btc?.usd || 0;
      if (price <= 0) throw new Error("BTC price is 0");
      return price;
    }, 2, 1500, "BTC price");
  } catch (_) {
    return 0;
  }
}

/**
 * Fetch TNK/USDT price in USD.
 * Primary:  Oracle VM proxy (/api/afos/api/prices) — same source as BTC/ETH/SOL prices.
 * Fallback: Gate.io public REST API (no API key required).
 */
async function fetchTnkPriceUsd(): Promise<number> {
  // Primary: server-side tRPC prices.live (30s cache, Gate.io + MEXC fallback — no CORS)
  try {
    const res = await fetch("/api/trpc/prices.live", {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      const price = json?.result?.data?.tnkPrice ?? json?.result?.data?.json?.tnkPrice ?? 0;
      if (price > 0) return price;
    }
  } catch (_) {}
  // Secondary: Oracle VM proxy
  try {
    const res = await fetch("/api/afos/api/prices");
    if (res.ok) {
      const data = await res.json();
      const price = data.prices?.TNK?.usd || data.prices?.tnk?.usd || 0;
      if (price > 0) return price;
    }
  } catch (_) {}
  // Last resort: Gate.io public REST API
  try {
    const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=TNK_USDT");
    if (res.ok) {
      const data = await res.json();
      const last = parseFloat(data?.[0]?.last ?? "0");
      if (last > 0) return last;
    }
  } catch (_) {}
  return 0;
}

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve within `ms`,
 * reject with a descriptive error. This prevents Tap Wallet API calls from
 * hanging forever when the extension's BroadcastChannel relay is broken
 * (e.g., due to Phantom or MetaMask content-script conflicts).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s — the Tap Wallet extension may not be responding. Try refreshing the page or disabling conflicting extensions.`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Retry a promise-returning function with exponential backoff.
 * On failure, waits `baseDelayMs * 2^attempt` before retrying.
 * Returns the last error if all attempts fail.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 2000,
  label: string = "fetch"
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[${label}] Attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delay}ms...`, err);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Parse TNK balance from the wallet's raw string (smallest-unit, 18 decimals)
 * to a human-readable decimal string.  TNK uses 18 decimals (like ETH wei),
 * so "1000000000000000000" → "1.0000".
 * Uses BigInt to avoid floating-point precision loss.
 */
function parseTnkBalance(raw: string | undefined | null): string {
  if (!raw || raw === "0" || raw === "") return "0.0000";
  try {
    const wei = BigInt(raw);
    const divisor = BigInt("1000000000000000000"); // 10^18
    const whole = wei / divisor;
    const remainder = wei % divisor;
    // Take first 4 decimal digits from the remainder
    const decimalStr = remainder.toString().padStart(18, "0").slice(0, 4);
    return `${whole.toString()}.${decimalStr}`;
  } catch {
    return "0.0000";
  }
}

// ─── Solana balance fetcher via backend tRPC (avoids browser CORS/403 from public RPC) ──

async function fetchSolanaBalancesForAddress(
  address: string
): Promise<{ balances: Array<{ symbol: string; amount: string; usdValue: number }>; totalUsd: number } | null> {
  try {
    return await withRetry(async () => {
      const encoded = encodeURIComponent(JSON.stringify({ "0": { json: { address } } }));
      const res = await fetch(`/api/trpc/htlcWallet.getSolanaBalanceByAddress?batch=1&input=${encoded}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batchResult = await res.json();
      const data = batchResult?.[0]?.result?.data?.json;
      if (!data) throw new Error("No data in response");

      const balances = [
        { symbol: "SOL",  amount: data.solBalance.toFixed(4),  usdValue: data.solUsd },
        { symbol: "USDT", amount: data.usdtBalance.toFixed(2), usdValue: data.usdtUsd },
        { symbol: "USDC", amount: data.usdcBalance.toFixed(2), usdValue: data.usdcUsd },
      ];
      return { balances, totalUsd: data.totalUsd };
    }, 3, 2000, "SOL balance");
  } catch (err) {
    console.warn("[MultiChainWallet] SOL balance fetch failed after 3 retries:", err);
    return null; // Return null so callers can preserve last-known-good values
  }
}

// ─── Wallet session persistence keys ─────────────────────────────────────────
const WALLET_SESSION_KEY = "afos_wallet_session";
/** localStorage key for the user's preferred BTC wallet (persists across refreshes) */
const PREFERRED_BTC_WALLET_KEY = "afos_preferred_btc_wallet";

type WalletSession = {
  eth?: EthProviderType;   // "metamask" | "phantom" — Phantom is handled by phantom key
  btc?: BtcProviderType;   // "metamask" | "tap" | "phantom" — Phantom is handled by phantom key
  phantom?: true;          // Phantom multi-chain was connected
};

function saveWalletSession(session: WalletSession) {
  try { localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
}

function loadWalletSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(WALLET_SESSION_KEY);
    return raw ? (JSON.parse(raw) as WalletSession) : null;
  } catch (_) { return null; }
}

function clearWalletSession() {
  try { localStorage.removeItem(WALLET_SESSION_KEY); } catch (_) {}
}

/** Persist the user’s preferred BTC wallet to localStorage */
function savePreferredBtcWallet(pref: BtcProviderType | null) {
  try {
    if (pref) localStorage.setItem(PREFERRED_BTC_WALLET_KEY, pref);
    else localStorage.removeItem(PREFERRED_BTC_WALLET_KEY);
  } catch (_) {}
}

/** Load the user’s preferred BTC wallet from localStorage */
function loadPreferredBtcWallet(): BtcProviderType | null {
  try {
    const raw = localStorage.getItem(PREFERRED_BTC_WALLET_KEY);
    if (raw === "metamask" || raw === "tap" || raw === "phantom") return raw;
  } catch (_) {}
  return null;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MultiChainWalletProvider({ children }: { children: ReactNode }) {
  const [ethereum, setEthereum] = useState<ChainWallet | null>(null);
  const [bitcoin, setBitcoin] = useState<ChainWallet | null>(null);
  /** Separate state for Tap Wallet BTC — allows Phantom/MetaMask BTC and Tap Wallet BTC to coexist */
  const [bitcoinTap, setBitcoinTap] = useState<ChainWallet | null>(null);
  /** Preferred BTC wallet when multiple are connected — initialised from localStorage */
  const [preferredBtcWallet, setPreferredBtcWalletRaw] = useState<BtcProviderType | null>(
    () => loadPreferredBtcWallet()
  );
  /** Wrapper that persists the preference to localStorage on every change */
  const setPreferredBtcWallet = useCallback((pref: BtcProviderType | null) => {
    setPreferredBtcWalletRaw(pref);
    savePreferredBtcWallet(pref);
  }, []);
  const [tracNetwork, setTracNetwork] = useState<ChainWallet | null>(null);
  const [erc20Balances, setErc20Balances] = useState<EthErc20Balances>({ usdc: 0, usdt: 0 });
  const [phantomMultiChain, setPhantomMultiChain] = useState<PhantomMultiChainState | null>(null);
  const [ethConnecting, setEthConnecting] = useState(false);
  const [btcConnecting, setBtcConnecting] = useState(false);
  const [phantomConnecting, setPhantomConnecting] = useState(false);
  // Refs to connect functions — populated after useCallback definitions so the
  // auto-reconnect effect can call them without being in their dependency arrays.
  const connectEthereumRef = React.useRef<((p: EthProviderType) => Promise<void>) | null>(null);
  const connectBitcoinRef = React.useRef<((p: BtcProviderType) => Promise<void>) | null>(null);
  const connectPhantomRef = React.useRef<(() => Promise<void>) | null>(null);

  // ── Phantom Multi-Chain Connect ─────────────────────────────────────────────
  // Phantom exposes window.phantom.solana, window.phantom.ethereum, window.phantom.bitcoin
  // We connect all three simultaneously and populate ethereum + bitcoin state
  const connectPhantomMultiChain = useCallback(async () => {
    const ph = window.phantom;
    if (!ph) {
      toast.error("Phantom not detected", {
        description: "Please install the Phantom browser extension.",
        action: { label: "Install", onClick: () => window.open("https://phantom.app/download", "_blank") },
      });
      return;
    }

    setPhantomConnecting(true);
    const connectedChains: Chain[] = [];
    let solanaAddress: string | undefined;
    let ethereumAddress: string | undefined;
    let bitcoinAddress: string | undefined;

    try {
      // ── Solana via Phantom ──
      if (ph.solana?.isPhantom) {
        try {
          const resp = await ph.solana.connect();
          solanaAddress = resp.publicKey.toString();
          connectedChains.push("solana");
        } catch (e) {
          console.warn("[Phantom] Solana connect failed:", e);
        }
      }

      // ── Ethereum via Phantom ──
      if (ph.ethereum) {
        try {
          const accounts = await ph.ethereum.request({ method: "eth_requestAccounts" }) as string[];
          if (accounts?.length) {
            ethereumAddress = accounts[0];
            connectedChains.push("ethereum");

            // Fetch ETH balance + ERC-20 balances
            const [balanceHex, priceUsd, usdcBal, usdtBal] = await Promise.all([
              ph.ethereum.request({ method: "eth_getBalance", params: [ethereumAddress, "latest"] }) as Promise<string>,
              fetchEthPriceUsd(),
              fetchErc20Balance(ph.ethereum, ERC20_CONTRACTS.USDC, ethereumAddress, 6),
              fetchErc20Balance(ph.ethereum, ERC20_CONTRACTS.USDT, ethereumAddress, 6),
            ]);

            const balanceEth = parseInt(balanceHex, 16) / 1e18;
            setErc20Balances({ usdc: usdcBal, usdt: usdtBal });
            setEthereum({
              chain: "ethereum",
              walletName: "Phantom",
              address: ethereumAddress,
              shortAddress: shortAddr(ethereumAddress),
              balance: balanceEth.toFixed(4),
              balanceUsd: balanceEth * priceUsd,
              symbol: "ETH",
              connected: true,
              connecting: false,
              isPhantom: true,
            });

            // Listen for account changes
            ph.ethereum.on?.("accountsChanged", (accs: unknown) => {
              const newAccs = accs as string[];
              if (!newAccs?.length) {
                disconnectPhantom();
              } else {
                setEthereum(prev => prev ? { ...prev, address: newAccs[0], shortAddress: shortAddr(newAccs[0]) } : null);
              }
            });
          }
        } catch (e) {
          console.warn("[Phantom] Ethereum connect failed:", e);
        }
      }

      // ── Bitcoin via Phantom ──
      if (ph.bitcoin?.isPhantom) {
        try {
          const btcAccounts = await ph.bitcoin.requestAccounts();
          // Prefer payment (p2wpkh / p2tr) address
          const paymentAcc = btcAccounts.find(a => a.purpose === "payment" || a.addressType === "p2wpkh" || a.addressType === "p2tr")
            ?? btcAccounts[0];

          if (paymentAcc) {
            bitcoinAddress = paymentAcc.address;
            connectedChains.push("bitcoin");

            const [btcResult, priceUsd] = await Promise.all([
              fetchBtcBalanceFromMempool(bitcoinAddress),
              fetchBtcPriceUsd(),
            ]);
            const btc = btcResult?.btc ?? "0.00000000";
            const sats = btcResult?.sats ?? 0;

            setBitcoin({
              chain: "bitcoin",
              walletName: "Phantom",
              address: bitcoinAddress,
              shortAddress: shortAddr(bitcoinAddress),
              balance: btc,
              balanceUsd: (sats / 1e8) * priceUsd,
              symbol: "BTC",
              connected: true,
              connecting: false,
              isPhantom: true,
            });
          }
        } catch (e) {
          console.warn("[Phantom] Bitcoin connect failed:", e);
        }
      }

      if (connectedChains.length === 0) {
        toast.error("Phantom connection failed", { description: "No chains could be connected." });
        return;
      }

      // Set state immediately (without SOL balances) so the UI updates fast
      setPhantomMultiChain({
        connected: true,
        chains: connectedChains,
        solanaAddress,
        ethereumAddress,
        bitcoinAddress,
      });

      // Fetch Solana balances in the background and update state when ready
      if (solanaAddress) {
        fetchSolanaBalancesForAddress(solanaAddress)
          .then((result) => {
            if (!result) return; // Keep existing state on failure
            setPhantomMultiChain(prev => prev ? {
              ...prev,
              solanaBalances: result.balances,
              solanaTotalUsd: result.totalUsd,
            } : null);
          })
          .catch(e => console.warn("[Phantom] SOL balance fetch failed:", e));
      }

      // Toast is handled by ConnectWalletModal's showWalletConnectedToast to avoid duplicates
      // Persist session so we can auto-reconnect on next page load
      saveWalletSession({ phantom: true });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("rejected") && !msg.includes("denied")) {
        toast.error("Phantom connection failed", { description: msg });
      }
    } finally {
      setPhantomConnecting(false);
    }
  }, []);

  // ── Refresh Solana balances for Phantom multi-chain connection ──────────────
  const refreshPhantomSolBalance = useCallback(async () => {
    const addr = phantomMultiChain?.solanaAddress;
    if (!addr) return;
    try {
      const result = await fetchSolanaBalancesForAddress(addr);
      if (!result) return; // Keep existing state on failure
      setPhantomMultiChain(prev => prev ? { ...prev, solanaBalances: result.balances, solanaTotalUsd: result.totalUsd } : null);
    } catch (e) {
      console.warn("[Phantom] SOL balance refresh failed:", e);
    }
  }, [phantomMultiChain?.solanaAddress]);

  const disconnectPhantom = useCallback(() => {
    // Disconnect Phantom Solana
    window.phantom?.solana?.disconnect().catch(() => {});
    // Clear ETH + BTC state that came from Phantom
    setEthereum(prev => prev?.isPhantom ? null : prev);
    setBitcoin(prev => prev?.isPhantom ? null : prev);
    setErc20Balances(prev => {
      // Only clear if ETH was from Phantom
      return { usdc: 0, usdt: 0 };
    });
    setPhantomMultiChain(null);
    clearWalletSession();
    const phantomChains = (phantomMultiChain?.chains ?? ["solana", "ethereum", "bitcoin"]) as ("solana" | "ethereum" | "bitcoin")[];
    showWalletDisconnectedToast("Phantom", phantomChains);
  }, []);

  // ── Ethereum (non-Phantom) ────────────────────────────────────────────────

  const connectEthereum = useCallback(async (providerType: EthProviderType) => {
    // Route Phantom to the multi-chain connector
    if (providerType === "phantom") {
      await connectPhantomMultiChain();
      return;
    }

    setEthConnecting(true);
    try {
      const provider = getEthProvider(providerType);
      if (!provider) {
        toast.error("MetaMask not detected", {
          description: "Please install MetaMask and refresh.",
          action: { label: "Install", onClick: () => window.open("https://metamask.io/download/", "_blank") },
        });
        return;
      }

      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.length) throw new Error("No accounts returned");

      const address = accounts[0];
      const balanceHex = await provider.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      }) as string;
      const balanceEth = parseInt(balanceHex, 16) / 1e18;
      const priceUsd = await fetchEthPriceUsd();

      const [usdcBalance, usdtBalance] = await Promise.all([
        fetchErc20Balance(provider, ERC20_CONTRACTS.USDC, address, 6),
        fetchErc20Balance(provider, ERC20_CONTRACTS.USDT, address, 6),
      ]);
      setErc20Balances({ usdc: usdcBalance, usdt: usdtBalance });

      const walletName = providerType === "metamask" ? "MetaMask" : "Phantom";
      setEthereum({
        chain: "ethereum",
        walletName,
        address,
        shortAddress: shortAddr(address),
        balance: balanceEth.toFixed(4),
        balanceUsd: balanceEth * priceUsd,
        symbol: "ETH",
        connected: true,
        connecting: false,
        isPhantom: false,
      });

      // Toast is handled by ConnectWalletModal's showWalletConnectedToast to avoid duplicates
      // Persist session for auto-reconnect on next page load
      saveWalletSession({ eth: providerType });

      provider.on?.("accountsChanged", (accs: unknown) => {
        const newAccs = accs as string[];
        if (!newAccs?.length) {
          disconnectEthereum();
        } else {
          setEthereum(prev => prev ? { ...prev, address: newAccs[0], shortAddress: shortAddr(newAccs[0]) } : null);
        }
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("rejected") && !msg.includes("denied")) {
        toast.error("Ethereum connection failed", { description: msg });
      }
    } finally {
      setEthConnecting(false);
    }
  }, [connectPhantomMultiChain]);

  const disconnectEthereum = useCallback(() => {
    setEthereum(null);
    setErc20Balances({ usdc: 0, usdt: 0 });
    clearWalletSession();
    if (phantomMultiChain) {
      // If Phantom was connected, disconnect all Phantom chains
      disconnectPhantom();
    } else {
      showWalletDisconnectedToast(ethereum?.walletName ?? "Ethereum Wallet", ["ethereum"]);
    }
  }, [phantomMultiChain, disconnectPhantom]);

  // ── Bitcoin / MetaMask (native BTC via Multichain API) ──────────────────────

  const connectMetaMaskBitcoin = useCallback(async () => {
    // MetaMask exposes Bitcoin via the CAIP-25 Multichain API.
    // Chain ID for Bitcoin mainnet: bip122:000000000019d6689c085ae165831e93
    const eth = window.ethereum as EthWindowProvider | undefined;
    if (!eth) {
      toast.error("MetaMask not detected", {
        description: "Please install the MetaMask browser extension.",
        action: { label: "Install", onClick: () => window.open("https://metamask.io/download", "_blank") },
      });
      return;
    }

    try {
      // Step 1: Request a multichain session that includes the Bitcoin mainnet scope.
      // MetaMask will prompt the user to approve the Bitcoin account access.
      const sessionResult = await eth.request({
        method: "wallet_createSession",
        params: [{
          optionalScopes: {
            "bip122:000000000019d6689c085ae165831e93": {
              methods: ["sendTransfer"],
              notifications: [],
            },
          },
        }],
      }) as {
        sessionScopes?: Record<string, { accounts?: string[] }>;
      };

      // Step 2: Extract the BTC address from the session response.
      // Accounts are returned as CAIP-10 strings: "bip122:000000000019d6689c085ae165831e93:bc1q..."
      const btcScope = sessionResult?.sessionScopes?.["bip122:000000000019d6689c085ae165831e93"];
      const caip10Accounts = btcScope?.accounts ?? [];

      if (!caip10Accounts.length) {
        // Fallback: try wallet_getSession to retrieve already-approved BTC accounts
        const existingSession = await eth.request({ method: "wallet_getSession" }) as {
          sessionScopes?: Record<string, { accounts?: string[] }>;
        };
        const existingBtcScope = existingSession?.sessionScopes?.["bip122:000000000019d6689c085ae165831e93"];
        const existingAccounts = existingBtcScope?.accounts ?? [];
        if (!existingAccounts.length) {
          throw new Error("No Bitcoin accounts returned from MetaMask. Make sure you have updated MetaMask to the latest version.");
        }
        caip10Accounts.push(...existingAccounts);
      }

      // CAIP-10 format: "namespace:chainId:address" — take the part after the second colon
      const address = caip10Accounts[0].split(":").slice(2).join(":");
      if (!address) throw new Error("Could not parse Bitcoin address from MetaMask session");

      const [btcResult, priceUsd] = await Promise.all([
        fetchBtcBalanceFromMempool(address),
        fetchBtcPriceUsd(),
      ]);
      const btcBalance = btcResult?.btc ?? "0.00000000";
      const sats = btcResult?.sats ?? 0;
      const balanceUsd = (sats / 1e8) * priceUsd;

      setBitcoin({
        chain: "bitcoin",
        walletName: "MetaMask",
        address,
        shortAddress: shortAddr(address),
        balance: btcBalance,
        balanceUsd,
        symbol: "BTC",
        connected: true,
        connecting: false,
        isPhantom: false,
      });
      saveWalletSession({ btc: "metamask" });
      toast.success("MetaMask BTC connected", { description: `${shortAddr(address)} · ${btcBalance} BTC` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancel") && !msg.includes("reject") && !msg.includes("User rejected")) {
        toast.error("MetaMask BTC connection failed", { description: msg });
      }
    }
  }, []);

  // Helper: wait for window.tracnetwork to be ready (up to `ms` milliseconds).
  //
  // The Tap Wallet extension:
  //   1. Injects tap-script.js synchronously at document_start
  //   2. Sets window.tracnetwork via Object.defineProperty
  //   3. Dispatches `tracnetwork#initialized` event when fully ready
  //
  // The AFOS bundle is wrapped in an IIFE (vite.config.ts: format: 'iife') so
  // our minified variable names (St, It, Lt, etc.) live in a private scope and
  // never collide with tap-script.js's global-scope declarations.
  //
  // We listen for the ready event first (most reliable), then fall back to polling.
  const waitForTracNetwork = useCallback(async (ms = 5000): Promise<boolean> => {
    if (window.tracnetwork) {
      console.log("[AFOS] Tap Wallet: already available");
      return true;
    }
    console.log("[AFOS] Tap Wallet: waiting for tracnetwork#initialized event or poll…");
    return new Promise<boolean>(resolve => {
      let resolved = false;
      const done = (found: boolean, via: string) => {
        if (resolved) return;
        resolved = true;
        clearInterval(interval);
        window.removeEventListener("tracnetwork#initialized", onEvent);
        if (found) console.log(`[AFOS] Tap Wallet: detected via ${via}`);
        else console.warn(`[AFOS] Tap Wallet: not detected after ${ms}ms`);
        resolve(found);
      };

      // Primary: listen for the official ready event
      const onEvent = () => done(true, "tracnetwork#initialized event");
      window.addEventListener("tracnetwork#initialized", onEvent);

      // Fallback: poll every 150ms
      let elapsed = 0;
      const step = 150;
      const interval = setInterval(() => {
        elapsed += step;
        if (window.tracnetwork) {
          done(true, `poll after ${elapsed}ms`);
        } else if (elapsed >= ms) {
          done(false, "timeout");
        }
      }, step);
    });
  }, []);

  const connectTapWallet = useCallback(async () => {
    // Wait for window.tracnetwork (TNK provider) to be ready
    const detected = await waitForTracNetwork(5000);
    if (!detected) {
      // Check if the extension script was injected but failed due to a conflict
      // (SyntaxError: Identifier '$t' has already been declared — caused by
      // MetaMask, Phantom, or other wallet extensions injecting the same variable)
      const hasConflict = !window.tracnetwork;
      if (hasConflict) {
        // Detect which conflicting extensions are present
        const hasMetaMask = !!(window as unknown as Record<string, unknown>).ethereum;
        const hasPhantom = !!(window as unknown as Record<string, unknown>).phantom;
        const conflictNames = [hasMetaMask && "MetaMask", hasPhantom && "Phantom"].filter(Boolean).join(" and ");
        const conflictHint = conflictNames
          ? `${conflictNames} ${conflictNames.includes("and") ? "are" : "is"} installed and may be conflicting.`
          : "Another wallet extension may be conflicting.";
        toast.error("Tap Wallet not responding", {
          description: `${conflictHint} Open Chrome Extensions (chrome://extensions), temporarily disable the conflicting wallet, then refresh this page.`,
          duration: 12000,
          action: {
            label: "Retry",
            onClick: () => {
              window.location.reload();
            },
          },
        });
      } else {
        toast.error("Tap Wallet not detected", {
          description: "Please install the Tap Wallet extension and refresh the page.",
          action: { label: "Install", onClick: () => window.open("https://chromewebstore.google.com/detail/tap-wallet/blcaacmeglnfblclocdgaomhopnfobof", "_blank") },
        });
      }
      return;
    }
    try {
      // ── Step 1: Connect TNK via window.tracnetwork ─────────────────────────────────────
      console.log("[AFOS] Tap Wallet: calling tracnetwork.requestAccount()\u2026");
      const tnkAddress = await withTimeout(
        window.tracnetwork!.requestAccount(),
        15000,
        "tracnetwork.requestAccount()"
      );
      console.log("[AFOS] Tap Wallet: TNK address", tnkAddress);

      const [rawTnkBalance, tnkPriceUsd] = await Promise.all([
        withTimeout(window.tracnetwork!.getBalance(), 10000, "tracnetwork.getBalance()"),
        fetchTnkPriceUsd(),
      ]);
      const tnkBalance = parseTnkBalance(rawTnkBalance);
      const tnkBalanceUsd = parseFloat(tnkBalance) * tnkPriceUsd;

      setTracNetwork({
        chain: "trac_network",
        walletName: "Tap Wallet",
        address: tnkAddress,
        shortAddress: shortAddr(tnkAddress),
        balance: `${tnkBalance} TNK`,
        balanceUsd: tnkBalanceUsd,
        symbol: "TNK",
        connected: true,
        connecting: false,
        isPhantom: false,
      });

      // ── Step 2: Connect BTC via window.tapprotocol (if available) ──────────────────
      let connectedBtcAddress: string | null = null;
      if (window.tapprotocol) {
        try {
          console.log("[AFOS] Tap Wallet: calling tapprotocol.requestAccounts()\u2026");
          const btcAccounts = await withTimeout(
            window.tapprotocol.requestAccounts(),
            15000,
            "tapprotocol.requestAccounts()"
          );
          const btcAddress = btcAccounts?.[0];
          if (btcAddress) {
            connectedBtcAddress = btcAddress;
            console.log("[AFOS] Tap Wallet: BTC address", btcAddress);
            const [btcResult, btcPrice] = await Promise.all([
              fetchBtcBalanceFromMempool(btcAddress),
              fetchBtcPriceUsd(),
            ]);
            const btcBal = btcResult?.btc ?? "0.00000000";
            const sats = btcResult?.sats ?? 0;
            setBitcoinTap({
              chain: "bitcoin",
              walletName: "Tap Wallet",
              address: btcAddress,
              shortAddress: shortAddr(btcAddress),
              balance: `${btcBal} BTC`,
              balanceUsd: (sats / 1e8) * btcPrice,
              symbol: "BTC",
              connected: true,
              connecting: false,
              isPhantom: false,
            });
            // If no Phantom/MetaMask BTC is connected yet, also populate bitcoin for backward compat
            setBitcoin(prev => prev && prev.walletName !== "Tap Wallet" ? prev : {
              chain: "bitcoin",
              walletName: "Tap Wallet",
              address: btcAddress,
              shortAddress: shortAddr(btcAddress),
              balance: `${btcBal} BTC`,
              balanceUsd: (sats / 1e8) * btcPrice,
              symbol: "BTC",
              connected: true,
              connecting: false,
              isPhantom: false,
            });
          }
        } catch (btcErr) {
          console.warn("[AFOS] Tap Wallet: BTC connect failed (non-fatal)", btcErr);
        }
      } else {
        console.log("[AFOS] Tap Wallet: window.tapprotocol not available, BTC not connected");
      }

      saveWalletSession({ btc: "tap" });

      // Fire ONE combined toast with both BTC + TNK addresses.
      // This runs AFTER both setTracNetwork() and setBitcoin() have been called,
      // so both addresses are guaranteed to be available.
      const tapAddrs: { chain: "solana" | "ethereum" | "bitcoin" | "trac_network"; address: string }[] = [];
      if (connectedBtcAddress) {
        tapAddrs.push({ chain: "bitcoin", address: shortAddr(connectedBtcAddress) });
      }
      tapAddrs.push({ chain: "trac_network", address: shortAddr(tnkAddress) });
      showWalletConnectedToast("Tap Wallet", tapAddrs);

      // ── accountsChanged: update TNK address when user switches accounts ─────────────
      window.tracnetwork?.on?.("accountsChanged", async (...args: unknown[]) => {
        const newAccounts = args[0] as string[] | string | undefined;
        const newAddress = Array.isArray(newAccounts) ? newAccounts[0] : newAccounts;
        if (!newAddress) {
          // User disconnected all accounts in the extension
          setTracNetwork(null);
          setBitcoinTap(null);
          // Only clear bitcoin state if it was set by Tap Wallet
          setBitcoin(prev => prev?.walletName === "Tap Wallet" ? null : prev);
          // Fall back to Phantom/MetaMask BTC if still connected, otherwise clear
          setBitcoin(prev => {
            const remaining = prev as ChainWallet | null;
            const phantomOrMm = remaining?.connected && remaining.walletName !== "Tap Wallet";
            const newPrefEvt1 = phantomOrMm ? (remaining?.isPhantom ? "phantom" : "metamask") : null;
            setPreferredBtcWallet(newPrefEvt1);
            if (newPrefEvt1) showBtcWalletSwitchedToast(remaining?.walletName ?? (remaining?.isPhantom ? "Phantom" : "MetaMask"));
            return prev;
          });
          clearWalletSession();
          showWalletDisconnectedToast("Tap Wallet", ["bitcoin", "trac_network"]);
          return;
        }
        // Refresh TNK balance for the new address
        try {
          const [rawBal, tnkPrice] = await Promise.all([
            withTimeout(window.tracnetwork!.getBalance(), 10000, "tracnetwork.getBalance() [accountsChanged]"),
            fetchTnkPriceUsd(),
          ]);
          const newTnk = parseTnkBalance(rawBal);
          setTracNetwork(prev => prev ? {
            ...prev,
            address: newAddress,
            shortAddress: shortAddr(newAddress),
            balance: `${newTnk} TNK`,
            balanceUsd: parseFloat(newTnk) * tnkPrice,
          } : null);
          toast.info("Tap Wallet account changed", {
            description: `Switched to ${shortAddr(newAddress)}`,
          });
        } catch (_) {}
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[AFOS] Tap Wallet connection error:", err);
      const isUserCancel = msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("denied");
      const isTimeout = msg.toLowerCase().includes("timed out");
      if (isTimeout) {
        toast.error("Tap Wallet not responding", {
          description: "The extension didn't respond in time. This usually happens when other wallet extensions (MetaMask, Phantom) interfere with Tap Wallet's messaging. Try: 1) Refresh the page, 2) Disable other wallet extensions in chrome://extensions, 3) Try again.",
          duration: 12000,
        });
      } else if (!isUserCancel) {
        toast.error("Tap Wallet connection failed", { description: msg });
      }
    }
  }, [waitForTracNetwork]);

  const connectBitcoin = useCallback(async (provider: BtcProviderType) => {
    // Route Phantom to the multi-chain connector
    if (provider === "phantom") {
      await connectPhantomMultiChain();
      return;
    }
    setBtcConnecting(true);
    try {
      if (provider === "metamask") await connectMetaMaskBitcoin();
      else await connectTapWallet(); // "tap" — Tap Wallet
    } finally {
      setBtcConnecting(false);
    }
  }, [connectMetaMaskBitcoin, connectTapWallet, connectPhantomMultiChain]);

  // ── Unified BTC PSBT signing ─────────────────────────────────────────────────
  // Auto-routes to the preferred BTC wallet (preferredBtcWallet) or the last-connected one.
  const btcSignPsbt = useCallback(async (psbtBase64: string, inputsToSign?: number[]): Promise<string> => {
    // Determine which wallet to use: prefer explicit preference, then active bitcoin state
    const activeBtcWallet = (() => {
      if (preferredBtcWallet === "tap") return bitcoinTap;
      if (preferredBtcWallet === "phantom" || preferredBtcWallet === "metamask") {
        const nonTap = bitcoin?.walletName !== "Tap Wallet" ? bitcoin : null;
        return nonTap ?? bitcoin;
      }
      return bitcoin;
    })();
    const walletName = activeBtcWallet?.walletName ?? (phantomMultiChain?.chains.includes("bitcoin") ? "Phantom" : null);
    if (!walletName) throw new Error("No Bitcoin wallet connected");

    // ── Phantom ──────────────────────────────────────────────────────────────
    if (walletName === "Phantom" || bitcoin?.isPhantom) {
      const ph = window.phantom?.bitcoin;
      if (!ph) throw new Error("Phantom Bitcoin provider not available");
      const psbtBytes = Uint8Array.from(atob(psbtBase64), c => c.charCodeAt(0));
      const signedBytes = await ph.signPSBT(psbtBytes, {
        inputsToSign: inputsToSign?.map(i => ({ index: i, sighashTypes: [0x01] })),
      });
      return btoa(Array.from(signedBytes).map(b => String.fromCharCode(b)).join(""));
    }

    // ── Tap Wallet (uses window.tapprotocol for BTC signing) ────────────────────────────────────────────────────────────────────────────────────────────
    if (walletName === "Tap Wallet") {
      // Use window.tapprotocol (BTC provider) for PSBT signing, not window.tracnetwork (TNK)
      const tap = window.tapprotocol;
      if (!tap?.signPsbt) throw new Error("Tap Wallet BTC provider (tapprotocol) not available for PSBT signing");
      const psbtHex = Array.from(Uint8Array.from(atob(psbtBase64), c => c.charCodeAt(0)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const signedHex = await tap.signPsbt(psbtHex);
      const signedBytes = signedHex.match(/.{2}/g)!.map(h => parseInt(h, 16));
      return btoa(Array.from(signedBytes).map(b => String.fromCharCode(b)).join(""));
    }

    // ── MetaMask (Bitcoin Snap) ────────────────────────────────────────────────────────────────────────────────────────────
    if (walletName === "MetaMask") {
      const eth = window.ethereum;
      if (!eth) throw new Error("MetaMask not available");
      const BITCOIN_SNAP_ID = "npm:@consensys/bitcoin-snap";
      const result = await eth.request({
        method: "wallet_invokeSnap",
        params: {
          snapId: BITCOIN_SNAP_ID,
          request: { method: "btc_signPsbt", params: { psbt: psbtBase64, inputsToSign } },
        },
      }) as { signedPsbt: string };
      return result.signedPsbt;
    }

    throw new Error(`btcSignPsbt: unsupported wallet "${walletName}"`);
  }, [bitcoin, bitcoinTap, preferredBtcWallet, phantomMultiChain]);

  const disconnectBitcoin = useCallback(() => {
    if (bitcoin?.isPhantom) {
      disconnectPhantom();
    } else {
      const isTap = bitcoin?.walletName === "Tap Wallet" || bitcoinTap !== null;
      if (isTap) {
        setTracNetwork(null);
        setBitcoinTap(null);
        // Tap Wallet BTC disconnected — fall back to Phantom/MetaMask BTC if still connected
        // (bitcoin state here is the active wallet; if it’s Tap Wallet, check if Phantom/MetaMask BTC exists)
        const phantomOrMmBtc = bitcoin?.walletName !== "Tap Wallet" && bitcoin?.connected;
        const newPrefA = phantomOrMmBtc ? (bitcoin?.isPhantom ? "phantom" : "metamask") : null;
        setPreferredBtcWallet(newPrefA);
        if (newPrefA) showBtcWalletSwitchedToast(bitcoin?.walletName ?? (bitcoin?.isPhantom ? "Phantom" : "MetaMask"));
      } else {
        // Phantom/MetaMask BTC disconnected — fall back to Tap Wallet BTC if still connected
        const tapStillConnected = (bitcoinTap as ChainWallet | null)?.connected ?? false;
        const newPrefB = tapStillConnected ? "tap" : null;
        setPreferredBtcWallet(newPrefB);
        if (newPrefB) showBtcWalletSwitchedToast("Tap Wallet");
      }
      setBitcoin(null);
      clearWalletSession();
      if (isTap) {
        showWalletDisconnectedToast("Tap Wallet", ["bitcoin", "trac_network"]);
      } else {
        showWalletDisconnectedToast(bitcoin?.walletName ?? "Bitcoin Wallet", ["bitcoin"]);
      }
    }
  }, [bitcoin, bitcoinTap, disconnectPhantom]);
  const disconnectTracNetwork = useCallback(() => {
    const isTap = tracNetwork?.walletName === "Tap Wallet";
    setTracNetwork(null);
    setBitcoinTap(null);
    // Only clear bitcoin state if it was set by Tap Wallet
    setBitcoin(prev => prev?.walletName === "Tap Wallet" ? null : prev);
    // Fall back to Phantom/MetaMask BTC if still connected, otherwise clear
    const remainingBtc = (bitcoin as ChainWallet | null);
    const phantomOrMmStillConnected = remainingBtc?.connected && remainingBtc.walletName !== "Tap Wallet";
    const newPrefTnk = phantomOrMmStillConnected ? (remainingBtc?.isPhantom ? "phantom" : "metamask") : null;
    setPreferredBtcWallet(newPrefTnk);
    if (newPrefTnk) showBtcWalletSwitchedToast(remainingBtc?.walletName ?? (remainingBtc?.isPhantom ? "Phantom" : "MetaMask"));
    clearWalletSession();
    showWalletDisconnectedToast("Tap Wallet", isTap ? ["bitcoin", "trac_network"] : ["trac_network"]);
  }, [tracNetwork, bitcoin]);

  // ── Assign connect refs (updated every render so they always point to latest callbacks) ──
  connectEthereumRef.current = connectEthereum;
  connectBitcoinRef.current = connectBitcoin;
  connectPhantomRef.current = connectPhantomMultiChain;

  // ── Silent Tap Wallet restore (no popup) ────────────────────────────────────
  // Dual-provider: restores TNK via window.tracnetwork AND BTC via window.tapprotocol.
  // Uses read-only calls (getAddress / requestAccounts) to avoid showing a popup.
  const silentRestoreTapWallet = useCallback(async () => {
    const detected = await waitForTracNetwork(5000);
    if (!detected) {
      console.log("[AFOS] Silent Tap Wallet restore: extension not detected, clearing session");
      clearWalletSession();
      return;
    }
    try {
      // ── Restore TNK via window.tracnetwork ──────────────────────────────────
      const tnkAddress = await withTimeout(
        window.tracnetwork!.getAddress(),
        10000,
        "tracnetwork.getAddress() [silent restore]"
      );
      if (!tnkAddress) {
        clearWalletSession();
        return;
      }
      const [rawBalance, tnkPriceUsd] = await Promise.all([
        withTimeout(window.tracnetwork!.getBalance(), 10000, "tracnetwork.getBalance() [silent restore]"),
        fetchTnkPriceUsd(),
      ]);
      const tnkBalance = parseTnkBalance(rawBalance);
      const tnkBalanceUsd = parseFloat(tnkBalance) * tnkPriceUsd;

      setTracNetwork({
        chain: "trac_network",
        walletName: "Tap Wallet",
        address: tnkAddress,
        shortAddress: shortAddr(tnkAddress),
        balance: `${tnkBalance} TNK`,
        balanceUsd: tnkBalanceUsd,
        symbol: "TNK",
        connected: true,
        connecting: false,
        isPhantom: false,
      });

      // ── Restore BTC via window.tapprotocol (if available) ──────────────────
      if (window.tapprotocol) {
        try {
          const btcAccounts = await withTimeout(
            window.tapprotocol.requestAccounts(),
            10000,
            "tapprotocol.requestAccounts() [silent restore]"
          );
          const btcAddress = btcAccounts?.[0];
          if (btcAddress) {
            const [btcResult, btcPriceUsd] = await Promise.all([
              fetchBtcBalanceFromMempool(btcAddress),
              fetchBtcPriceUsd(),
            ]);
            const btcBalance = btcResult?.btc ?? "0.00000000";
            const sats = btcResult?.sats ?? 0;
            setBitcoinTap({
              chain: "bitcoin",
              walletName: "Tap Wallet",
              address: btcAddress,
              shortAddress: shortAddr(btcAddress),
              balance: `${btcBalance} BTC`,
              balanceUsd: (sats / 1e8) * btcPriceUsd,
              symbol: "BTC",
              connected: true,
              connecting: false,
              isPhantom: false,
            });
            // If no Phantom/MetaMask BTC is connected, also set bitcoin for backward compat
            setBitcoin(prev => prev && prev.walletName !== "Tap Wallet" ? prev : {
              chain: "bitcoin",
              walletName: "Tap Wallet",
              address: btcAddress,
              shortAddress: shortAddr(btcAddress),
              balance: `${btcBalance} BTC`,
              balanceUsd: (sats / 1e8) * btcPriceUsd,
              symbol: "BTC",
              connected: true,
              connecting: false,
              isPhantom: false,
            });
            console.log(`[AFOS] Tap Wallet silently restored BTC: ${shortAddr(btcAddress)}`);
          }
        } catch (btcErr) {
          console.warn("[AFOS] Silent Tap Wallet BTC restore failed (non-fatal):", btcErr);
        }
      }

      // Re-register accountsChanged listener for TNK
      window.tracnetwork?.on?.("accountsChanged", async (...args: unknown[]) => {
        const newAccounts = args[0] as string[] | string | undefined;
        const newAddress = Array.isArray(newAccounts) ? newAccounts[0] : newAccounts;
        if (!newAddress) {
          setTracNetwork(null);
          setBitcoinTap(null);
          // Only clear bitcoin state if it was set by Tap Wallet
          setBitcoin(prev => prev?.walletName === "Tap Wallet" ? null : prev);
          // Fall back to Phantom/MetaMask BTC if still connected, otherwise clear
          setBitcoin(prev => {
            const remaining = prev as ChainWallet | null;
            const phantomOrMm = remaining?.connected && remaining.walletName !== "Tap Wallet";
            const newPrefEvt2 = phantomOrMm ? (remaining?.isPhantom ? "phantom" : "metamask") : null;
            setPreferredBtcWallet(newPrefEvt2);
            if (newPrefEvt2) showBtcWalletSwitchedToast(remaining?.walletName ?? (remaining?.isPhantom ? "Phantom" : "MetaMask"));
            return prev;
          });
          clearWalletSession();
          showWalletDisconnectedToast("Tap Wallet", ["bitcoin", "trac_network"]);
          return;
        }
        try {
          const [rawBal, tnkPrice] = await Promise.all([
            withTimeout(window.tracnetwork!.getBalance(), 10000, "tracnetwork.getBalance() [restore accountsChanged]"),
            fetchTnkPriceUsd(),
          ]);
          const newTnk = parseTnkBalance(rawBal);
          setTracNetwork(prev => prev ? {
            ...prev,
            address: newAddress,
            shortAddress: shortAddr(newAddress),
            balance: `${newTnk} TNK`,
            balanceUsd: parseFloat(newTnk) * tnkPrice,
          } : null);
        } catch (_) {}
      });
    } catch (err) {
      console.warn("[AFOS] Silent Tap Wallet restore failed:", err);
      clearWalletSession();
    }
  }, [waitForTracNetwork]);

  // ── Auto-reconnect on mount ─────────────────────────────────────────────────────────
  // Silently restores the last wallet session on page load without showing any popup.
  // For Phantom: checks window.phantom.solana.isConnected (already approved, no prompt).
  // For ETH: uses eth_accounts (read-only, no popup) to verify the session is still valid.
  // For BTC Tap Wallet: uses getAddress() (read-only, no popup) via silentRestoreTapWallet.
  // For BTC MetaMask: calls connect functions which handle their own silent checks.
  useEffect(() => {
    const session = loadWalletSession();
    if (!session) return;

    // Wait 800ms for wallet extensions to inject into window
    const timer = setTimeout(async () => {
      try {
        if (session.phantom) {
          // Phantom: reconnect only if the extension reports it is already connected
          if (window.phantom?.solana?.publicKey) {
            await connectPhantomRef.current?.();
          } else {
            // Session is stale (user revoked in Phantom) — clear it
            clearWalletSession();
          }
        } else {
          if (session.eth) {
            // eth_accounts is a read-only call — returns authorised accounts without a popup
            const provider = window.ethereum as { request: (a: { method: string }) => Promise<string[]> } | undefined;
            if (provider) {
              const accounts = await provider.request({ method: "eth_accounts" });
              if (accounts?.length) {
                // Accounts still authorised — reconnect silently
                await connectEthereumRef.current?.(session.eth);
              } else {
                // Authorisation was revoked — clear stale session
                clearWalletSession();
              }
            }
          }
          if (session.btc && session.btc !== "phantom") {
            if (session.btc === "tap") {
              // Tap Wallet: use silent restore with getAddress() (no popup)
              await silentRestoreTapWallet();
            } else {
              // MetaMask BTC: attempt reconnect via its connect function
              await connectBitcoinRef.current?.(session.btc);
            }
          }
        }
      } catch (_) {
        // Auto-reconnect failed — clear session to avoid retrying on every refresh
        clearWalletSession();
      }
    }, 800);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-refresh ETH native + ERC-20 balances every 30 seconds ───────────────────────────────
  useEffect(() => {
    if (!ethereum?.connected || !ethereum.address) return;

    const refreshEthBalances = async () => {
      // Use Phantom's ethereum provider if connected via Phantom, else window.ethereum
      const provider = (ethereum.isPhantom ? window.phantom?.ethereum : window.ethereum) as EthProvider | undefined;
      if (!provider) return;
      try {
        const [balanceHex, priceUsd, usdc, usdt] = await Promise.all([
          provider.request({ method: "eth_getBalance", params: [ethereum.address, "latest"] }) as Promise<string>,
          fetchEthPriceUsd(),
          fetchErc20Balance(provider, ERC20_CONTRACTS.USDC, ethereum.address, 6),
          fetchErc20Balance(provider, ERC20_CONTRACTS.USDT, ethereum.address, 6),
        ]);
        const balanceEth = parseInt(balanceHex, 16) / 1e18;
        setEthereum(prev => prev ? {
          ...prev,
          balance: balanceEth.toFixed(4),
          balanceUsd: balanceEth * priceUsd,
        } : null);
        setErc20Balances({ usdc, usdt });
      } catch (err) {
        console.warn("[ETH refresh] Failed:", err);
        // Keep existing state on failure
      }
    };

    const interval = setInterval(refreshEthBalances, 30_000);
    return () => clearInterval(interval);
  }, [ethereum?.connected, ethereum?.address, ethereum?.isPhantom]);

  // ── Auto-refresh BTC balance every 60 seconds ─────────────────────────────
  useEffect(() => {
    if (!bitcoin?.connected || !bitcoin.address) return;

    const refreshBtcBalance = async () => {
      try {
        // Fetch BTC balance from mempool (BTC only — TNK is now in tracNetwork state)
        const [btcResult, priceUsd] = await Promise.all([
          fetchBtcBalanceFromMempool(bitcoin.address),
          fetchBtcPriceUsd(),
        ]);
        if (!btcResult) return; // Keep existing state on failure
        const balanceUsd = (btcResult.sats / 1e8) * priceUsd;
        setBitcoin(prev => {
          if (!prev) return null;
          return { ...prev, balance: `${btcResult.btc} BTC`, balanceUsd };
        });
      } catch (err) {
        console.warn("[BTC refresh] Failed:", err);
      }
    };

    // Also refresh TNK balance if tracNetwork is connected via Tap Wallet
    const refreshTnkBalance = async () => {
      if (!window.tracnetwork) return;
      try {
        const [rawBal, tnkPrice] = await Promise.all([
          withTimeout(window.tracnetwork.getBalance(), 10000, "tracnetwork.getBalance() [refresh]"),
          fetchTnkPriceUsd(),
        ]);
        const tnkBalance = parseTnkBalance(rawBal);
        setTracNetwork(prev => prev ? {
          ...prev,
          balance: `${tnkBalance} TNK`,
          balanceUsd: parseFloat(tnkBalance) * tnkPrice,
        } : null);
      } catch (err) {
        console.warn("[TNK refresh] Failed:", err);
      }
    };

    const btcInterval = setInterval(refreshBtcBalance, 30_000);
    const tnkInterval = setInterval(refreshTnkBalance, 30_000);
    return () => { clearInterval(btcInterval); clearInterval(tnkInterval); };
  }, [bitcoin?.connected, bitcoin?.address]);

  // ── Tap Wallet accountsChanged cleanup on disconnect ───────────────────────
  // The listener is registered inside connectTapWallet. When the user disconnects
  // (bitcoin becomes null), we remove the listener so it doesn't fire stale updates.
  useEffect(() => {
    if (bitcoin?.connected && bitcoin.walletName === "Tap Wallet") return; // still connected — keep listener
    // Disconnected or switched to a different wallet — remove the listener
    window.tracnetwork?.off?.("accountsChanged", () => {});
  }, [bitcoin?.connected, bitcoin?.walletName]);

  // ── Auto-refresh SOL balance every 30 seconds when Phantom multi-chain is connected ──
  useEffect(() => {
    const addr = phantomMultiChain?.solanaAddress;
    if (!addr) return;
    const interval = setInterval(() => {
      fetchSolanaBalancesForAddress(addr).then((result) => {
        if (!result) return; // Keep existing state on failure
        setPhantomMultiChain(prev => prev ? { ...prev, solanaBalances: result.balances, solanaTotalUsd: result.totalUsd } : null);
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [phantomMultiChain?.solanaAddress]);

  // ── Derived active BTC wallet (respects preferredBtcWallet) ─────────────────
  // When both Phantom/MetaMask BTC and Tap Wallet BTC are connected, use the preferred one.
  // If no preference is set, use the last-connected (bitcoin state).
  const activeBitcoin: ChainWallet | null = (() => {
    if (!preferredBtcWallet) return bitcoin;
    if (preferredBtcWallet === "tap") return bitcoinTap ?? bitcoin;
    // phantom or metamask
    const nonTap = bitcoin?.walletName !== "Tap Wallet" ? bitcoin : null;
    return nonTap ?? bitcoin;
  })();

  return (
    <MultiChainWalletContext.Provider value={{
      ethereum,
      bitcoin: activeBitcoin,
      bitcoinTap,
      preferredBtcWallet,
      setPreferredBtcWallet,
      tracNetwork,
      erc20Balances,
      phantomMultiChain,
      connectEthereum,
      connectBitcoin,
      connectPhantomMultiChain,
      disconnectEthereum,
      disconnectBitcoin,
      disconnectPhantom,
      disconnectTracNetwork,
      refreshPhantomSolBalance,
      ethConnecting,
      btcConnecting,
      phantomConnecting,
      btcSignPsbt,
    }}>
      {children}
    </MultiChainWalletContext.Provider>
  );
}
