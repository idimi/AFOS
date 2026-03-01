/**
 * MultiChainWalletContext
 * Manages wallet connections for three chains:
 *   - Solana: via @solana/wallet-adapter-react (Phantom, Solflare)
 *   - Ethereum: via EIP-1193 window.ethereum or window.phantom.ethereum (MetaMask, Coinbase, Phantom)
 *   - Bitcoin: via sats-connect (Xverse), window.tracnetwork (Tap Wallet), or window.phantom.bitcoin (Phantom)
 *
 * Phantom is a multi-chain wallet: connecting it once unlocks Solana, Ethereum, and Bitcoin simultaneously.
 * MetaMask → Ethereum only.
 * Coinbase Wallet → Ethereum only.
 * Xverse → Bitcoin only.
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
import { request as satsRequest, AddressPurpose } from "sats-connect";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Chain = "solana" | "ethereum" | "bitcoin";
export type EthProviderType = "metamask" | "coinbase" | "phantom";
export type BtcProviderType = "xverse" | "tap" | "phantom";

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
}

interface MultiChainWalletContextValue {
  ethereum: ChainWallet | null;
  bitcoin: ChainWallet | null;
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
  ethConnecting: boolean;
  btcConnecting: boolean;
  phantomConnecting: boolean;
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
    tracnetwork?: {
      requestAccount: () => Promise<string>;
      getBalance: () => Promise<string>;
      getNetwork: () => Promise<string>;
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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MultiChainWalletProvider({ children }: { children: ReactNode }) {
  const [ethereum, setEthereum] = useState<ChainWallet | null>(null);
  const [bitcoin, setBitcoin] = useState<ChainWallet | null>(null);
  const [erc20Balances, setErc20Balances] = useState<EthErc20Balances>({ usdc: 0, usdt: 0 });
  const [phantomMultiChain, setPhantomMultiChain] = useState<PhantomMultiChainState | null>(null);
  const [ethConnecting, setEthConnecting] = useState(false);
  const [btcConnecting, setBtcConnecting] = useState(false);
  const [phantomConnecting, setPhantomConnecting] = useState(false);

  // ── Phantom Multi-Chain Connect ───────────────────────────────────────────
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

      setPhantomMultiChain({
        connected: true,
        chains: connectedChains,
        solanaAddress,
        ethereumAddress,
        bitcoinAddress,
      });

      const chainLabels = connectedChains.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(" + ");
      toast.success(`Phantom connected — ${chainLabels}`, {
        description: solanaAddress ? shortAddr(solanaAddress) : shortAddr(ethereumAddress ?? ""),
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("rejected") && !msg.includes("denied")) {
        toast.error("Phantom connection failed", { description: msg });
      }
    } finally {
      setPhantomConnecting(false);
    }
  }, []);

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
    toast.info("Phantom disconnected from all chains");
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

      toast.success(`${walletName} connected`, { description: shortAddr(address) });

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
    if (phantomMultiChain) {
      // If Phantom was connected, disconnect all Phantom chains
      disconnectPhantom();
    } else {
      toast.info("Ethereum wallet disconnected");
    }
  }, [phantomMultiChain, disconnectPhantom]);

  // ── Bitcoin / Xverse ──────────────────────────────────────────────────────

  const connectXverse = useCallback(async () => {
    try {
      const response = await satsRequest("wallet_connect", {
        addresses: [AddressPurpose.Payment, AddressPurpose.Ordinals],
        message: "AFOS wants to connect to your Bitcoin wallet",
      });

      if (response.status === "success") {
        const paymentAddr = response.result.addresses.find(
          (a: { purpose: string }) => a.purpose === AddressPurpose.Payment
        );
        if (!paymentAddr) throw new Error("No payment address returned");

        const address = paymentAddr.address;
        const [{ btc: btcBalance, sats }, priceUsd] = await Promise.all([
          fetchBtcBalanceFromMempool(address),
          fetchBtcPriceUsd(),
        ]);
        const balanceUsd = (sats / 1e8) * priceUsd;

        setBitcoin({
          chain: "bitcoin",
          walletName: "Xverse",
          address,
          shortAddress: shortAddr(address),
          balance: btcBalance,
          balanceUsd,
          symbol: "BTC",
          connected: true,
          connecting: false,
          isPhantom: false,
        });
        toast.success("Xverse connected", { description: `${shortAddr(address)} · ${btcBalance} BTC` });
      } else if (response.status === "error") {
        const errMsg = (response as unknown as { error?: { message?: string } }).error?.message ?? "Unknown error";
        if (!errMsg.includes("cancel") && !errMsg.includes("reject")) {
          toast.error("Xverse connection failed", { description: errMsg });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancel") && !msg.includes("reject")) {
        toast.error("Xverse connection failed", { description: msg });
      }
    }
  }, []);

  const connectTapWallet = useCallback(async () => {
    if (!window.tracnetwork) {
      toast.error("Tap Wallet not detected", {
        description: "Please install the Tap Wallet extension and refresh.",
        action: { label: "Install", onClick: () => window.open("https://trac.network", "_blank") },
      });
      return;
    }
    try {
      const address = await window.tracnetwork.requestAccount();
      const rawBalance = await window.tracnetwork.getBalance();
      const tnkBalance = rawBalance ? (parseInt(rawBalance) / 1e8).toFixed(4) : "0.0000";

      const [{ btc: btcBalance, sats }, btcPriceUsd] = await Promise.all([
        fetchBtcBalanceFromMempool(address),
        fetchBtcPriceUsd(),
      ]);
      const btcBalanceUsd = (sats / 1e8) * btcPriceUsd;

      const displayBalance = sats > 0
        ? `${btcBalance} BTC / ${tnkBalance} TNK`
        : `${tnkBalance} TNK`;

      setBitcoin({
        chain: "bitcoin",
        walletName: "Tap Wallet",
        address,
        shortAddress: shortAddr(address),
        balance: displayBalance,
        balanceUsd: btcBalanceUsd,
        symbol: sats > 0 ? "BTC" : "TNK",
        connected: true,
        connecting: false,
        isPhantom: false,
      });
      toast.success("Tap Wallet connected", {
        description: `${shortAddr(address)} · ${btcBalance} BTC · ${tnkBalance} TNK`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancel") && !msg.includes("reject")) {
        toast.error("Tap Wallet connection failed", { description: msg });
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
      if (provider === "xverse") await connectXverse();
      else await connectTapWallet();
    } finally {
      setBtcConnecting(false);
    }
  }, [connectXverse, connectTapWallet, connectPhantomMultiChain]);

  const disconnectBitcoin = useCallback(() => {
    if (bitcoin?.isPhantom) {
      disconnectPhantom();
    } else {
      setBitcoin(null);
      toast.info("Bitcoin wallet disconnected");
    }
  }, [bitcoin, disconnectPhantom]);

  // ── Auto-refresh ERC-20 balances every 60 seconds ───────────────────────────
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
        const [{ btc, sats }, priceUsd] = await Promise.all([
          fetchBtcBalanceFromMempool(bitcoin.address),
          fetchBtcPriceUsd(),
        ]);
        const balanceUsd = (sats / 1e8) * priceUsd;

        setBitcoin(prev => {
          if (!prev) return null;
          const isTapWallet = prev.walletName === "Tap Wallet";
          const tnkPart = isTapWallet && prev.balance.includes("TNK")
            ? prev.balance.split(" / ")[1] ?? ""
            : "";
          const newBalance = isTapWallet && tnkPart
            ? (sats > 0 ? `${btc} BTC / ${tnkPart}` : tnkPart)
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

  return (
    <MultiChainWalletContext.Provider value={{
      ethereum,
      bitcoin,
      erc20Balances,
      phantomMultiChain,
      connectEthereum,
      connectBitcoin,
      connectPhantomMultiChain,
      disconnectEthereum,
      disconnectBitcoin,
      disconnectPhantom,
      ethConnecting,
      btcConnecting,
      phantomConnecting,
    }}>
      {children}
    </MultiChainWalletContext.Provider>
  );
}
