/**
 * MultiChainWalletContext
 * Manages wallet connections for four chains:
 *   - Solana: via @solana/wallet-adapter-react (Phantom, Solflare)
 *   - Ethereum: via EIP-1193 window.ethereum or window.phantom.ethereum (MetaMask, Coinbase, Phantom)
 *   - Bitcoin: via MetaMask Multichain API (CAIP-25), window.tapprotocol (Tap Wallet), or window.phantom.bitcoin (Phantom)
 *   - Trac Network (TNK): via window.tracnetwork (Tap Wallet)
 *
 * Phantom is a multi-chain wallet: connecting it once unlocks Solana, Ethereum, and Bitcoin simultaneously.
 * MetaMask → Ethereum + native Bitcoin via wallet_createSession (CAIP-25 bip122 scope).
 * Coinbase Wallet → Ethereum only.
 * Tap Wallet → Bitcoin (window.tapprotocol) + TNK (window.tracnetwork) simultaneously.
 * Solflare → Solana only (handled by @solana/wallet-adapter).
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
import { showWalletConnectedToast, showWalletDisconnectedToast } from "../components/ConnectWalletModal";
import type { SupportedChain } from "@shared/const";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Chain = SupportedChain;
export type EthProviderType = "metamask" | "coinbase" | "phantom";
export type BtcProviderType = "metamask" | "tap" | "phantom" | "xverse";

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
  bitcoin: ChainWallet | null;
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
   * Supports: Phantom, Xverse, Tap Wallet (window.tapprotocol), MetaMask (Bitcoin Snap).
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
  isCoinbaseWallet?: boolean;
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
    XverseProviders?: {
      BitcoinProvider?: {
        connect: (opts?: { purposes?: string[]; message?: string }) => Promise<{ addresses: { address: string; publicKey: string; purpose: string }[] }>;
        signPsbt: (request: { psbt: string; inputsToSign: { address: string; signingIndexes: number[] }[] }) => Promise<{ psbt: string }>;
        getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number }>;
      };
    };
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
  const eth = window.ethereum as EthWindowProvider | undefined;
  if (!eth) return null;
  if (eth.providers) {
    if (type === "metamask") return eth.providers.find((p: EthProvider) => p.isMetaMask && !p.isCoinbaseWallet) ?? null;
    if (type === "coinbase") return eth.providers.find((p: EthProvider) => p.isCoinbaseWallet) ?? null;
  }
  if (type === "metamask" && eth.isMetaMask) return eth;
  if (type === "coinbase" && eth.isCoinbaseWallet) return eth;
  return eth;
}

async function fetchEthPriceUsd(): Promise<number> {
  try {
    const res = await fetch("/api/afos/api/prices");
    if (res.ok) {
      const data = await res.json();
      return data.prices?.ETH?.usd || data.prices?.eth?.usd || 0;
    }
  } catch (_) {}
  return 0;
}

async function fetchBtcBalanceFromMempool(address: string): Promise<{ btc: string; sats: number }> {
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const sats: number =
      (data.chain_stats?.funded_txo_sum ?? 0) -
      (data.chain_stats?.spent_txo_sum ?? 0);
    const btc = (sats / 1e8).toFixed(8);
    return { btc, sats };
  } catch (err) {
    console.warn("[Mempool] BTC balance fetch failed:", err);
    return { btc: "0.00000000", sats: 0 };
  }
}

async function fetchBtcPriceUsd(): Promise<number> {
  try {
    const res = await fetch("/api/afos/api/prices");
    if (res.ok) {
      const data = await res.json();
      return data.prices?.BTC?.usd || data.prices?.btc?.usd || 0;
    }
  } catch (_) {}
  return 0;
}

// ─── Solana balance fetcher via backend tRPC (avoids browser CORS/403 from public RPC) ──

async function fetchSolanaBalancesForAddress(
  address: string
): Promise<{ balances: Array<{ symbol: string; amount: string; usdValue: number }>; totalUsd: number }> {
  try {
    // Call our backend tRPC procedure which fetches from Solana RPC server-side
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
  } catch (err) {
    console.warn("[MultiChainWallet] SOL balance fetch via backend failed:", err);
    return { balances: [], totalUsd: 0 };
  }
}

// ─── Wallet session persistence keys ─────────────────────────────────────────
const WALLET_SESSION_KEY = "afos_wallet_session";

type WalletSession = {
  eth?: EthProviderType;   // "metamask" | "coinbase" — Phantom is handled by phantom key
  btc?: BtcProviderType;   // "metamask" | "tap" | "xverse" — Phantom is handled by phantom key
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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MultiChainWalletProvider({ children }: { children: ReactNode }) {
  const [ethereum, setEthereum] = useState<ChainWallet | null>(null);
  const [bitcoin, setBitcoin] = useState<ChainWallet | null>(null);
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

            const [{ btc, sats }, priceUsd] = await Promise.all([
              fetchBtcBalanceFromMempool(bitcoinAddress),
              fetchBtcPriceUsd(),
            ]);

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
          .then(({ balances, totalUsd }) => {
            setPhantomMultiChain(prev => prev ? {
              ...prev,
              solanaBalances: balances,
              solanaTotalUsd: totalUsd,
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
      const { balances, totalUsd } = await fetchSolanaBalancesForAddress(addr);
      setPhantomMultiChain(prev => prev ? { ...prev, solanaBalances: balances, solanaTotalUsd: totalUsd } : null);
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
        const installUrl = providerType === "metamask"
          ? "https://metamask.io/download/"
          : "https://www.coinbase.com/wallet/downloads";
        toast.error(`${providerType === "metamask" ? "MetaMask" : "Coinbase Wallet"} not detected`, {
          description: "Please install the wallet extension and refresh.",
          action: { label: "Install", onClick: () => window.open(installUrl, "_blank") },
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

      const walletName = providerType === "metamask" ? "MetaMask" : "Coinbase Wallet";
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

      const [{ btc: btcBalance, sats }, priceUsd] = await Promise.all([
        fetchBtcBalanceFromMempool(address),
        fetchBtcPriceUsd(),
      ]);
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
  // Known issue: if another wallet extension (MetaMask, Phantom, etc.) declares
  // the same internal variable ($t) as tap-script.js, a SyntaxError prevents
  // window.tracnetwork from being initialized. User must disable conflicting
  // extensions or use a separate browser profile.
  //
  // We listen for that event first (most reliable), then fall back to polling.
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
        toast.error("Tap Wallet not responding", {
          description: "If you have MetaMask or Phantom installed, try disabling them temporarily — they can conflict with Tap Wallet's script injection. Then refresh the page.",
          duration: 8000,
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
      console.log("[AFOS] Tap Wallet: calling tracnetwork.requestAccount()…");
      const tnkAddress = await window.tracnetwork!.requestAccount();
      console.log("[AFOS] Tap Wallet: TNK address", tnkAddress);

      const rawTnkBalance = await window.tracnetwork!.getBalance();
      const tnkBalance = rawTnkBalance ? (parseInt(rawTnkBalance) / 1e8).toFixed(4) : "0.0000";

      setTracNetwork({
        chain: "trac_network",
        walletName: "Tap Wallet",
        address: tnkAddress,
        shortAddress: shortAddr(tnkAddress),
        balance: `${tnkBalance} TNK`,
        balanceUsd: 0,
        symbol: "TNK",
        connected: true,
        connecting: false,
        isPhantom: false,
      });

      // ── Step 2: Connect BTC via window.tapprotocol (if available) ──────────────────
      if (window.tapprotocol) {
        try {
          console.log("[AFOS] Tap Wallet: calling tapprotocol.requestAccounts()…");
          const btcAccounts = await window.tapprotocol.requestAccounts();
          const btcAddress = btcAccounts?.[0];
          if (btcAddress) {
            console.log("[AFOS] Tap Wallet: BTC address", btcAddress);
            const [{ btc: btcBal, sats }, btcPrice] = await Promise.all([
              fetchBtcBalanceFromMempool(btcAddress),
              fetchBtcPriceUsd(),
            ]);
            setBitcoin({
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
      toast.success("Tap Wallet connected", {
        description: `TNK: ${shortAddr(tnkAddress)} · ${tnkBalance} TNK`,
      });

      // ── accountsChanged: update TNK address when user switches accounts ─────────────
      window.tracnetwork?.on?.("accountsChanged", async (...args: unknown[]) => {
        const newAccounts = args[0] as string[] | string | undefined;
        const newAddress = Array.isArray(newAccounts) ? newAccounts[0] : newAccounts;
        if (!newAddress) {
          // User disconnected all accounts in the extension
          setTracNetwork(null);
          setBitcoin(null);
          clearWalletSession();
          showWalletDisconnectedToast("Tap Wallet", ["bitcoin", "trac_network"]);
          return;
        }
        // Refresh TNK balance for the new address
        try {
          const rawBal = await window.tracnetwork!.getBalance();
          const newTnk = rawBal ? (parseInt(rawBal) / 1e8).toFixed(4) : "0.0000";
          setTracNetwork(prev => prev ? {
            ...prev,
            address: newAddress,
            shortAddress: shortAddr(newAddress),
            balance: `${newTnk} TNK`,
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
      if (!isUserCancel) {
        toast.error("Tap Wallet connection failed", { description: msg });
      }
    }
  }, [waitForTracNetwork]);

  // ── Xverse Bitcoin Connect ────────────────────────────────────────────────
  const connectXverseBitcoin = useCallback(async () => {
    const xverse = window.XverseProviders?.BitcoinProvider;
    if (!xverse) {
      toast.error("Xverse not detected", {
        description: "Please install the Xverse browser extension.",
        action: { label: "Install", onClick: () => window.open("https://www.xverse.app/download", "_blank") },
      });
      return;
    }
    try {
      const result = await xverse.connect({ purposes: ["payment", "ordinals"], message: "AFOS needs access to your Bitcoin wallet" });
      const paymentAddr = result.addresses.find(a => a.purpose === "payment");
      const addr = paymentAddr?.address ?? result.addresses[0]?.address;
      if (!addr) throw new Error("No Bitcoin address returned from Xverse");
      const [{ btc, sats }, priceUsd] = await Promise.all([
        fetchBtcBalanceFromMempool(addr),
        fetchBtcPriceUsd(),
      ]);
      const balanceUsd = (sats / 1e8) * priceUsd;
      setBitcoin({
        chain: "bitcoin",
        walletName: "Xverse",
        address: addr,
        shortAddress: shortAddr(addr),
        balance: `${btc} BTC`,
        balanceUsd,
        symbol: "BTC",
        connected: true,
        connecting: false,
        isPhantom: false,
      });
      saveWalletSession({ btc: "xverse" });
      showWalletConnectedToast("Xverse", [{ chain: "bitcoin", address: shortAddr(addr) }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (!msg.includes("cancel") && !msg.includes("reject")) {
        toast.error("Xverse connection failed", { description: msg });
      }
    }
  }, []);

  const connectBitcoin = useCallback(async (provider: BtcProviderType) => {
    // Route Phantom to the multi-chain connector
    if (provider === "phantom") {
      await connectPhantomMultiChain();
      return;
    }
    setBtcConnecting(true);
    try {
      if (provider === "metamask") await connectMetaMaskBitcoin();
      else if (provider === "xverse") await connectXverseBitcoin();
      else await connectTapWallet();
    } finally {
      setBtcConnecting(false);
    }
  }, [connectMetaMaskBitcoin, connectTapWallet, connectPhantomMultiChain, connectXverseBitcoin]);

  // ── Unified BTC PSBT signing ─────────────────────────────────────────────────
  // Auto-routes to whichever BTC wallet is currently connected.
  const btcSignPsbt = useCallback(async (psbtBase64: string, inputsToSign?: number[]): Promise<string> => {
    const walletName = bitcoin?.walletName ?? (phantomMultiChain?.chains.includes("bitcoin") ? "Phantom" : null);
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

    // ── Xverse ───────────────────────────────────────────────────────────────
    if (walletName === "Xverse") {
      const xverse = window.XverseProviders?.BitcoinProvider;
      if (!xverse) throw new Error("Xverse provider not available");
      const address = bitcoin?.address ?? "";
      const result = await xverse.signPsbt({
        psbt: psbtBase64,
        inputsToSign: [{ address, signingIndexes: inputsToSign ?? [0] }],
      });
      return result.psbt;
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
  }, [bitcoin, phantomMultiChain]);

  const disconnectBitcoin = useCallback(() => {
    if (bitcoin?.isPhantom) {
      disconnectPhantom();
    } else {
      setBitcoin(null);
      clearWalletSession();
      showWalletDisconnectedToast(bitcoin?.walletName ?? "Bitcoin Wallet", ["bitcoin"]);
    }
  }, [bitcoin, disconnectPhantom]);

  const disconnectTracNetwork = useCallback(() => {
    setTracNetwork(null);
    // Also clear BTC if it was connected via Tap Wallet simultaneously
    if (bitcoin?.walletName === "Tap Wallet") {
      setBitcoin(null);
    }
    clearWalletSession();
    showWalletDisconnectedToast("Tap Wallet", ["trac_network"]);
  }, [bitcoin]);

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
      const tnkAddress = await window.tracnetwork!.getAddress();
      if (!tnkAddress) {
        clearWalletSession();
        return;
      }
      const rawBalance = await window.tracnetwork!.getBalance();
      const tnkBalance = rawBalance ? (parseInt(rawBalance) / 1e8).toFixed(4) : "0.0000";

      setTracNetwork({
        chain: "trac_network",
        walletName: "Tap Wallet",
        address: tnkAddress,
        shortAddress: shortAddr(tnkAddress),
        balance: `${tnkBalance} TNK`,
        balanceUsd: 0,
        symbol: "TNK",
        connected: true,
        connecting: false,
        isPhantom: false,
      });
      console.log(`[AFOS] Tap Wallet silently restored TNK: ${shortAddr(tnkAddress)}`);

      // ── Restore BTC via window.tapprotocol (if available) ──────────────────
      if (window.tapprotocol) {
        try {
          const btcAccounts = await window.tapprotocol.requestAccounts();
          const btcAddress = btcAccounts?.[0];
          if (btcAddress) {
            const [{ btc: btcBalance, sats }, btcPriceUsd] = await Promise.all([
              fetchBtcBalanceFromMempool(btcAddress),
              fetchBtcPriceUsd(),
            ]);
            setBitcoin({
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
          setBitcoin(null);
          clearWalletSession();
          showWalletDisconnectedToast("Tap Wallet", ["bitcoin", "trac_network"]);
          return;
        }
        try {
          const rawBal = await window.tracnetwork!.getBalance();
          const newTnk = rawBal ? (parseInt(rawBal) / 1e8).toFixed(4) : "0.0000";
          setTracNetwork(prev => prev ? {
            ...prev,
            address: newAddress,
            shortAddress: shortAddr(newAddress),
            balance: `${newTnk} TNK`,
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
  // For BTC Xverse/MetaMask: calls connect functions which handle their own silent checks.
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
              // Xverse/MetaMask BTC: attempt reconnect via their connect functions
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

  // ── Auto-refresh ERC-20 balances every 60 seconds ───────────────────────────────────────────
  useEffect(() => {
    if (!ethereum?.connected || !ethereum.address) return;

    const refreshErc20 = async () => {
      // Use Phantom's ethereum provider if connected via Phantom, else window.ethereum
      const provider = (ethereum.isPhantom ? window.phantom?.ethereum : window.ethereum) as EthProvider | undefined;
      if (!provider) return;
      const [usdc, usdt] = await Promise.all([
        fetchErc20Balance(provider, ERC20_CONTRACTS.USDC, ethereum.address, 6),
        fetchErc20Balance(provider, ERC20_CONTRACTS.USDT, ethereum.address, 6),
      ]);
      setErc20Balances({ usdc, usdt });
    };

    const interval = setInterval(refreshErc20, 60_000);
    return () => clearInterval(interval);
  }, [ethereum?.connected, ethereum?.address, ethereum?.isPhantom]);

  // ── Auto-refresh BTC balance every 60 seconds ─────────────────────────────
  useEffect(() => {
    if (!bitcoin?.connected || !bitcoin.address) return;

    const refreshBtcBalance = async () => {
      try {
        // Fetch BTC balance from mempool (BTC only — TNK is now in tracNetwork state)
        const [{ btc, sats }, priceUsd] = await Promise.all([
          fetchBtcBalanceFromMempool(bitcoin.address),
          fetchBtcPriceUsd(),
        ]);
        const balanceUsd = (sats / 1e8) * priceUsd;
        setBitcoin(prev => {
          if (!prev) return null;
          return { ...prev, balance: `${btc} BTC`, balanceUsd };
        });
      } catch (err) {
        console.warn("[BTC refresh] Failed:", err);
      }
    };

    // Also refresh TNK balance if tracNetwork is connected via Tap Wallet
    const refreshTnkBalance = async () => {
      if (!window.tracnetwork) return;
      try {
        const rawBal = await window.tracnetwork.getBalance();
        const tnkBalance = rawBal ? (parseInt(rawBal) / 1e8).toFixed(4) : "0.0000";
        setTracNetwork(prev => prev ? { ...prev, balance: `${tnkBalance} TNK` } : null);
      } catch (err) {
        console.warn("[TNK refresh] Failed:", err);
      }
    };

    const btcInterval = setInterval(refreshBtcBalance, 60_000);
    const tnkInterval = setInterval(refreshTnkBalance, 60_000);
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

  // ── Auto-refresh SOL balance every 60 seconds when Phantom multi-chain is connected ──
  useEffect(() => {
    const addr = phantomMultiChain?.solanaAddress;
    if (!addr) return;
    const interval = setInterval(() => {
      fetchSolanaBalancesForAddress(addr).then(({ balances, totalUsd }) => {
        setPhantomMultiChain(prev => prev ? { ...prev, solanaBalances: balances, solanaTotalUsd: totalUsd } : null);
      }).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [phantomMultiChain?.solanaAddress]);

  return (
    <MultiChainWalletContext.Provider value={{
      ethereum,
      bitcoin,
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
