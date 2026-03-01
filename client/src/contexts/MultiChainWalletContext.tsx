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

interface MultiChainWalletContextValue {
  ethereum: ChainWallet | null;
  bitcoin: ChainWallet | null;
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
        const priceUsd = await fetchBtcPriceUsd();

        // Xverse doesn't expose balance directly via sats-connect — show 0 until we add RPC query
        setBitcoin({
          chain: "bitcoin",
          walletName: "Xverse",
          address,
          shortAddress: shortAddr(address),
          balance: "—",
          balanceUsd: 0,
          symbol: "BTC",
          connected: true,
          connecting: false,
        });
        toast.success("Xverse connected", { description: shortAddr(address) });
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
      // TNK balance is returned as integer string in smallest unit — treat as whole units for now
      const balance = rawBalance ? (parseInt(rawBalance) / 1e8).toFixed(4) : "0.0000";

      setBitcoin({
        chain: "bitcoin",
        walletName: "Tap Wallet",
        address,
        shortAddress: shortAddr(address),
        balance,
        balanceUsd: 0, // TNK has no reliable USD price feed yet
        symbol: "TNK",
        connected: true,
        connecting: false,
      });
      toast.success("Tap Wallet connected", { description: shortAddr(address) });
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

  return (
    <MultiChainWalletContext.Provider value={{
      ethereum,
      bitcoin,
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
