/**
 * MultiChainWalletContext
 * Manages wallet connections for three chains:
 *   - Solana: via @solana/wallet-adapter-react (Phantom, Solflare)
 *   - Ethereum: via EIP-1193 window.ethereum or window.phantom.ethereum (MetaMask, Coinbase, Phantom)
 *   - Bitcoin: via MetaMask Multichain API (CAIP-25), window.tracnetwork (Tap Wallet), or window.phantom.bitcoin (Phantom)
 *
 * Phantom is a multi-chain wallet: connecting it once unlocks Solana, Ethereum, and Bitcoin simultaneously.
 * MetaMask → Ethereum + native Bitcoin via wallet_createSession (CAIP-25 bip122 scope).
 * Coinbase Wallet → Ethereum only.
 * Tap Wallet → Bitcoin + TNK only.
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

// ─── Types ────────────────────────────────────────────────────────────────────

export type Chain = "solana" | "ethereum" | "bitcoin" | "trac_network";
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
  /** TNK / Trac Network wallet — populated when Tap Wallet is connected via window.tracnetwork */
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
  /** Disconnect the TNK / Trac Network wallet (window.tracnetwork) */
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
    /**
     * Tap Wallet — Bitcoin / TAP Protocol provider (window.tapprotocol)
     * Source: https://github.com/Trac-Systems/tap-wallet-extension/blob/main/src/content-script/tap-script/index.ts
     * Event: tapprotocol#initialized
     */
    tapprotocol?: {
      requestAccounts: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number }>;
      getNetwork: () => Promise<string>;
      switchNetwork: (network: string) => Promise<void>;
      getPublicKey: () => Promise<string>;
      signMessage: (text: string, type: string) => Promise<string>;
      signPsbt: (psbtHex: string, options?: unknown) => Promise<string>;
      signPsbts: (psbtHexs: string[], options?: unknown[]) => Promise<string[]>;
      pushTx: (rawtx: string) => Promise<string>;
      pushPsbt: (psbtHex: string) => Promise<string>;
      sendBitcoin: (toAddress: string, satoshis: number, options?: { feeRate?: number; memo?: string }) => Promise<string>;
      getBitcoinUtxos: (cursor?: number, size?: number) => Promise<unknown[]>;
      disconnect: () => Promise<void>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      off?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
    /**
     * Tap Wallet — TNK / Trac Network provider (window.tracnetwork)
     * Source: https://github.com/Trac-Systems/tap-wallet-extension/blob/main/src/content-script/tap-script/index.ts
     * Event: tracnetwork#initialized
     */
    tracnetwork?: {
      requestAccount: () => Promise<string>;
      getAddress: () => Promise<string>;
      getBalance: () => Promise<string>;
      getNetwork: () => Promise<string>;
      switchNetwork: (network: string) => Promise<void>;
      getPublicKey: () => Promise<string>;
      signMessage: (message: string) => Promise<string>;
      sendTNK: (from: string, to: string, amount: string) => Promise<string>;
      buildTracTx: (params: { from?: string; to: string; amount: string }) => Promise<string>;
      pushTracTx: (txPayload: string) => Promise<string>;
      signTracTx: (contractTx: unknown) => Promise<string>;
      /** EventEmitter methods — per official Tap Wallet API */
      on: (event: "accountsChanged" | "networkChanged" | string, listener: (...args: unknown[]) => void) => void;
      off: (event: string, listener: (...args: unknown[]) => void) => void;
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
  /** TNK / Trac Network wallet state — populated by window.tracnetwork (Tap Wallet) */
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

  // ── Tap Wallet Connect (reimplemented per official GitHub source) ─────────────
  //
  // Source: https://github.com/Trac-Systems/tap-wallet-extension/blob/main/src/content-script/tap-script/index.ts
  //
  // The extension injects TWO separate window objects:
  //   - window.tapprotocol  → Bitcoin / TAP Protocol (BTC addresses, PSBT signing)
  //     Event: tapprotocol#initialized
  //   - window.tracnetwork  → TNK / Trac Network (TNK addresses, TNK transactions)
  //     Event: tracnetwork#initialized
  //
  // Both are injected simultaneously, so connecting Tap Wallet gives BTC + TNK.
  //
  // Detection strategy: poll for BOTH providers for up to 3s since extensions
  // inject asynchronously after page load.
  const connectTapWallet = useCallback(async () => {
    // Step 1: Poll for both providers (extensions inject asynchronously)
    const hasTap = !!window.tapprotocol;
    const hasTrac = !!window.tracnetwork;

    if (!hasTap && !hasTrac) {
      console.log("[AFOS] Tap Wallet: providers not yet available, polling…");
      const found = await new Promise<boolean>(resolve => {
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 100;
          // Consider found if at least one provider is available
          if (window.tapprotocol || window.tracnetwork) {
            clearInterval(interval);
            resolve(true);
          } else if (elapsed >= 3000) {
            clearInterval(interval);
            resolve(false);
          }
        }, 100);
      });
      if (!found) {
        toast.error("Tap Wallet not detected", {
          description: "Please install the Tap Wallet extension and refresh the page.",
          action: { label: "Install", onClick: () => window.open("https://chromewebstore.google.com/detail/tap-wallet/blcaacmeglnfblclocdgaomhopnfobof", "_blank") },
          duration: 8000,
        });
        return;
      }
    }

    // Step 2: Connect both providers in parallel
    const btcPromise = window.tapprotocol
      ? window.tapprotocol.requestAccounts().catch((e: unknown) => { console.warn("[AFOS] tapprotocol.requestAccounts failed:", e); return null; })
      : Promise.resolve(null);

    const tnkPromise = window.tracnetwork
      ? window.tracnetwork.requestAccount().catch((e: unknown) => { console.warn("[AFOS] tracnetwork.requestAccount failed:", e); return null; })
      : Promise.resolve(null);

    let btcAccounts: string[] | null = null;
    let tnkAddress: string | null = null;

    try {
      [btcAccounts, tnkAddress] = await Promise.all([btcPromise, tnkPromise]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancel") && !msg.includes("reject") && !msg.includes("User rejected")) {
        toast.error("Tap Wallet connection failed", { description: msg });
      }
      return;
    }

    if (!btcAccounts?.length && !tnkAddress) {
      toast.error("Tap Wallet connection failed", { description: "No addresses returned. Please try again." });
      return;
    }

    // Step 3: Store BTC wallet (from window.tapprotocol)
    if (btcAccounts?.length) {
      const btcAddr = btcAccounts[0];
      let btcBal = "0.00000000";
      let btcUsd = 0;
      try {
        const [{ btc, sats }, priceUsd] = await Promise.all([
          fetchBtcBalanceFromMempool(btcAddr),
          fetchBtcPriceUsd(),
        ]);
        btcBal = btc;
        btcUsd = (sats / 1e8) * priceUsd;
      } catch (_) {
        console.warn("[AFOS] Tap Wallet: BTC balance fetch failed");
      }
      setBitcoin({
        chain: "bitcoin",
        walletName: "Tap Wallet",
        address: btcAddr,
        shortAddress: shortAddr(btcAddr),
        balance: `${btcBal} BTC`,
        balanceUsd: btcUsd,
        symbol: "BTC",
        connected: true,
        connecting: false,
        isPhantom: false,
      });
      console.log("[AFOS] Tap Wallet: BTC connected", btcAddr);

      // Register accountsChanged listener for BTC
      window.tapprotocol?.on?.("accountsChanged", async (...args: unknown[]) => {
        const newAccounts = args[0] as string[] | undefined;
        const newAddr = newAccounts?.[0];
        if (!newAddr) {
          setBitcoin(null);
          clearWalletSession();
          showWalletDisconnectedToast("Tap Wallet", ["bitcoin"]);
          return;
        }
        try {
          const [{ btc: newBtc, sats: newSats }, newPrice] = await Promise.all([
            fetchBtcBalanceFromMempool(newAddr),
            fetchBtcPriceUsd(),
          ]);
          setBitcoin(prev => prev?.walletName === "Tap Wallet" ? {
            ...prev,
            address: newAddr,
            shortAddress: shortAddr(newAddr),
            balance: `${newBtc} BTC`,
            balanceUsd: (newSats / 1e8) * newPrice,
          } : prev);
        } catch (_) {}
      });
    }

    // Step 4: Store TNK wallet (from window.tracnetwork)
    if (tnkAddress) {
      let tnkBal = "0.0000";
      try {
        const rawBalance = await window.tracnetwork!.getBalance();
        tnkBal = rawBalance ? (parseInt(rawBalance) / 1e8).toFixed(4) : "0.0000";
      } catch (_) {
        console.warn("[AFOS] Tap Wallet: TNK balance fetch failed");
      }
      setTracNetwork({
        chain: "trac_network",
        walletName: "Tap Wallet",
        address: tnkAddress,
        shortAddress: shortAddr(tnkAddress),
        balance: `${tnkBal} TNK`,
        balanceUsd: 0,
        symbol: "TNK",
        connected: true,
        connecting: false,
        isPhantom: false,
      });
      console.log("[AFOS] Tap Wallet: TNK connected", tnkAddress);

      // Register accountsChanged listener for TNK
      window.tracnetwork!.on("accountsChanged", async (...args: unknown[]) => {
        const newAccounts = args[0] as string[] | string | undefined;
        const newAddr = Array.isArray(newAccounts) ? newAccounts[0] : newAccounts;
        if (!newAddr) {
          setTracNetwork(null);
          showWalletDisconnectedToast("Tap Wallet", ["trac_network"]);
          return;
        }
        try {
          const rawBal = await window.tracnetwork!.getBalance();
          const newTnk = rawBal ? (parseInt(rawBal) / 1e8).toFixed(4) : "0.0000";
          setTracNetwork(prev => prev ? {
            ...prev,
            address: newAddr,
            shortAddress: shortAddr(newAddr),
            balance: `${newTnk} TNK`,
          } : null);
        } catch (_) {}
      });
    }

    // Step 5: Save session and show success toast
    saveWalletSession({ btc: "tap" });
    const connectedChains: string[] = [];
    if (btcAccounts?.length) connectedChains.push(`${shortAddr(btcAccounts[0])} (BTC)`);
    if (tnkAddress) connectedChains.push(`${shortAddr(tnkAddress)} (TNK)`);
    toast.success("Tap Wallet connected", {
      description: connectedChains.join(" · "),
    });
  }, []);

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

    // ── Tap Wallet ────────────────────────────────────────────────────────────
    if (walletName === "Tap Wallet") {
      // Use window.tapprotocol for PSBT signing (Bitcoin provider)
      // Source: https://github.com/Trac-Systems/tap-wallet-extension
      const tap = window.tapprotocol;
      if (!tap) throw new Error("Tap Wallet (tapprotocol) provider not available");
      const psbtHex = Array.from(Uint8Array.from(atob(psbtBase64), c => c.charCodeAt(0)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const signedHex = await tap.signPsbt(psbtHex);
      const signedBytes = signedHex.match(/.{2}/g)!.map(h => parseInt(h, 16));
      return btoa(Array.from(signedBytes).map(b => String.fromCharCode(b)).join(""));
    }

    // ── MetaMask (Bitcoin Snap) ───────────────────────────────────────────────
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
      const wasTapWallet = bitcoin?.walletName === "Tap Wallet";
      setBitcoin(null);
      // If Tap Wallet was connected, also clear the TNK (tracNetwork) state
      if (wasTapWallet) {
        setTracNetwork(null);
      }
      clearWalletSession();
      showWalletDisconnectedToast(bitcoin?.walletName ?? "Bitcoin Wallet", ["bitcoin"]);
    }
  }, [bitcoin, disconnectPhantom]);

  const disconnectTracNetwork = useCallback(() => {
    setTracNetwork(null);
    // If bitcoin (BTC) is also from Tap Wallet, clear it too
    if (bitcoin?.walletName === "Tap Wallet") {
      setBitcoin(null);
      clearWalletSession();
    }
    showWalletDisconnectedToast("Tap Wallet", ["trac_network"]);
  }, [bitcoin]);

  // ── Assign connect refs (updated every render so they always point to latest callbacks) ──
  connectEthereumRef.current = connectEthereum;
  connectBitcoinRef.current = connectBitcoin;
  connectPhantomRef.current = connectPhantomMultiChain;

  // ── Auto-reconnect on mount ─────────────────────────────────────────────────────────
  // Silently restores the last wallet session on page load without showing any popup.
  // For Phantom: checks window.phantom.solana.isConnected (already approved, no prompt).
  // For ETH: uses eth_accounts (read-only, no popup) to verify the session is still valid.
  // For BTC (Xverse/Tap/MetaMask): calls connect functions which handle their own silent checks.
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
            // For Xverse/Tap/MetaMask BTC: attempt silent reconnect
            // connectBitcoin handles its own "not installed" gracefully
            await connectBitcoinRef.current?.(session.btc);
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
        // Fetch BTC balance from mempool and TNK balance from Tap Wallet API in parallel
        const isTapWallet = bitcoin.walletName === "Tap Wallet";
        const [{ btc, sats }, priceUsd, rawTnkBalance] = await Promise.all([
          fetchBtcBalanceFromMempool(bitcoin.address),
          fetchBtcPriceUsd(),
          isTapWallet && window.tracnetwork
            ? window.tracnetwork.getBalance().catch(() => null)
            : Promise.resolve(null),
        ]);
        const balanceUsd = (sats / 1e8) * priceUsd;

        setBitcoin(prev => {
          if (!prev) return null;
          const isTap = prev.walletName === "Tap Wallet";
          // Use fresh TNK balance from Tap Wallet API if available, otherwise preserve existing
          const freshTnk = rawTnkBalance != null
            ? `${(parseInt(String(rawTnkBalance)) / 1e8).toFixed(4)} TNK`
            : (prev.balance.includes("TNK") ? (prev.balance.split(" / ")[1] ?? "") : "");
          const newBalance = isTap && freshTnk
            ? (sats > 0 ? `${btc} BTC / ${freshTnk}` : freshTnk)
            : btc;
          return {
            ...prev,
            balance: newBalance,
            balanceUsd,
          };
        });
      } catch (err) {
        console.warn("[BTC refresh] Failed:", err);
      }
    };

    const interval = setInterval(refreshBtcBalance, 60_000);
    return () => clearInterval(interval);
  }, [bitcoin?.connected, bitcoin?.address]);

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

  // ── Auto-refresh TNK balance every 60 seconds when Tap Wallet is connected ────────────
  useEffect(() => {
    if (!tracNetwork?.connected || !tracNetwork.address) return;
    const refreshTnkBalance = async () => {
      try {
        if (!window.tracnetwork) return;
        const rawBalance = await window.tracnetwork.getBalance();
        const tnkBal = rawBalance ? (parseInt(rawBalance) / 1e8).toFixed(4) : "0.0000";
        setTracNetwork(prev => prev ? { ...prev, balance: `${tnkBal} TNK` } : null);
      } catch (err) {
        console.warn("[TNK refresh] Failed:", err);
      }
    };
    const interval = setInterval(refreshTnkBalance, 60_000);
    return () => clearInterval(interval);
  }, [tracNetwork?.connected, tracNetwork?.address]);

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
