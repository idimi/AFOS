/**
 * MultiChainWalletContext
 * Manages wallet connections for three chains:
 *   - Solana: via @solana/wallet-adapter-react (Phantom, Solflare)
 *   - Ethereum: via EIP-1193 window.ethereum (MetaMask, Coinbase Wallet)
 *   - Bitcoin: via sats-connect (Xverse) + window.tracnetwork (Tap Wallet)
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
}

export interface EthErc20Balances {
  usdc: number;   // USDC balance in human units (6 decimals)
  usdt: number;   // USDT balance in human units (6 decimals)
}

interface MultiChainWalletContextValue {
  ethereum: ChainWallet | null;
  bitcoin: ChainWallet | null;
  erc20Balances: EthErc20Balances;
  connectEthereum: (provider: "metamask" | "coinbase") => Promise<void>;
  connectBitcoin: (provider: "xverse" | "tap") => Promise<void>;
  disconnectEthereum: () => void;
  disconnectBitcoin: () => void;
  ethConnecting: boolean;
  btcConnecting: boolean;
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
// Encode call data: selector + address padded to 32 bytes
function encodeBalanceOf(address: string): string {
  const addr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  return `0x70a08231${addr}`;
}

// Fetch ERC-20 token balance for a given wallet address using eth_call
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

// Use a separate variable to avoid TS2717 conflict with @particle-network/auth which declares window.ethereum as any
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
  }
}

// Pick the right provider from window.ethereum (handles multi-wallet injection)
function getEthProvider(type: "metamask" | "coinbase"): EthProvider | null {
  const eth = window.ethereum as EthWindowProvider | undefined;
  if (!eth) return null;
  // Some browsers inject multiple providers under .providers array
  if (eth.providers) {
    if (type === "metamask") return eth.providers.find((p: EthProvider) => p.isMetaMask && !p.isCoinbaseWallet) ?? null;
    if (type === "coinbase") return eth.providers.find((p: EthProvider) => p.isCoinbaseWallet) ?? null;
  }
  // Single provider
  if (type === "metamask" && eth.isMetaMask) return eth;
  if (type === "coinbase" && eth.isCoinbaseWallet) return eth;
  // Fallback: return whatever is there
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

// Fetch confirmed BTC balance in BTC from Mempool.space
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
  const [ethConnecting, setEthConnecting] = useState(false);
  const [btcConnecting, setBtcConnecting] = useState(false);

  // ── Ethereum ──────────────────────────────────────────────────────────────

  const connectEthereum = useCallback(async (providerType: "metamask" | "coinbase") => {
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

      // Get ETH balance (returns hex wei)
      const balanceHex = await provider.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      }) as string;
      const balanceEth = parseInt(balanceHex, 16) / 1e18;

      const priceUsd = await fetchEthPriceUsd();

      // Fetch ERC-20 USDC + USDT balances in parallel
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
      });

      toast.success(`${walletName} connected`, { description: shortAddr(address) });

      // Listen for account changes
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
  }, []);

  const disconnectEthereum = useCallback(() => {
    setEthereum(null);
    setErc20Balances({ usdc: 0, usdt: 0 });
    toast.info("Ethereum wallet disconnected");
  }, []);

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
        // Fetch BTC balance from Mempool.space and USD price in parallel
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
        });
        toast.success("Xverse connected", { description: `${shortAddr(address)} · ${btcBalance} BTC` });
      } else if (response.status === "error") {
        const errMsg = (response as { status: string; error?: { message?: string } }).error?.message || "Unknown error";
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
      // TNK balance is returned as integer string in smallest unit
      const tnkBalance = rawBalance ? (parseInt(rawBalance) / 1e8).toFixed(4) : "0.0000";

      // Tap Wallet uses the same underlying Bitcoin key — fetch BTC balance from Mempool.space
      // The address returned by requestAccount() is a trac1... Bech32m address (P2TR)
      // which is a valid Bitcoin address on mainnet
      const [{ btc: btcBalance, sats }, btcPriceUsd] = await Promise.all([
        fetchBtcBalanceFromMempool(address),
        fetchBtcPriceUsd(),
      ]);
      const btcBalanceUsd = (sats / 1e8) * btcPriceUsd;

      // Show BTC balance as primary, TNK as secondary in the balance field
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

  const connectBitcoin = useCallback(async (provider: "xverse" | "tap") => {
    setBtcConnecting(true);
    try {
      if (provider === "xverse") await connectXverse();
      else await connectTapWallet();
    } finally {
      setBtcConnecting(false);
    }
  }, [connectXverse, connectTapWallet]);

  const disconnectBitcoin = useCallback(() => {
    setBitcoin(null);
    toast.info("Bitcoin wallet disconnected");
  }, []);

  // ── Auto-refresh ERC-20 balances every 60 seconds ───────────────────────────
  useEffect(() => {
    if (!ethereum?.connected || !ethereum.address) return;

    const refreshErc20 = async () => {
      const provider = window.ethereum as EthProvider | undefined;
      if (!provider) return;
      const [usdc, usdt] = await Promise.all([
        fetchErc20Balance(provider, ERC20_CONTRACTS.USDC, ethereum.address, 6),
        fetchErc20Balance(provider, ERC20_CONTRACTS.USDT, ethereum.address, 6),
      ]);
      setErc20Balances({ usdc, usdt });
    };

    const interval = setInterval(refreshErc20, 60_000);
    return () => clearInterval(interval);
  }, [ethereum?.connected, ethereum?.address]);

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
          // For Tap Wallet, preserve the TNK part of the display balance
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
            symbol: sats > 0 ? "BTC" : prev.symbol,
          };
        });
      } catch {
        // Silently ignore refresh errors — stale balance is fine
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
      connectEthereum,
      connectBitcoin,
      disconnectEthereum,
      disconnectBitcoin,
      ethConnecting,
      btcConnecting,
    }}>
      {children}
    </MultiChainWalletContext.Provider>
  );
}
