/**
 * WalletContext — Multi-chain wallet connection context
 * Design: Dark terminal aesthetic, AFOS brand
 * Supports: Solana (Phantom, Backpack, Solflare), EVM (MetaMask), Bitcoin (Xverse, TAP Wallet)
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { toast } from "sonner";

export type WalletChain = "solana" | "evm" | "bitcoin";

export interface ConnectedWallet {
  chain: WalletChain;
  name: string;
  address: string;
  shortAddress: string;
  icon: string;
  balances: WalletBalance[];
}

export interface WalletBalance {
  symbol: string;
  amount: string;
  usdValue: number;
  chain: WalletChain;
  decimals: number;
}

interface WalletContextValue {
  connectedWallets: ConnectedWallet[];
  isConnecting: boolean;
  connectWallet: (walletName: string, chain: WalletChain) => Promise<void>;
  disconnectWallet: (chain: WalletChain) => void;
  disconnectAll: () => void;
  totalPortfolioUsd: number;
  primaryWallet: ConnectedWallet | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

// Simulated wallet detection — in production these would call window.phantom, window.ethereum, etc.
const WALLET_CONFIGS: Record<string, { chain: WalletChain; icon: string; mockAddress: string }> = {
  Phantom: {
    chain: "solana",
    icon: "https://phantom.app/img/phantom-logo.svg",
    mockAddress: "7xKp...9mNz",
  },
  Backpack: {
    chain: "solana",
    icon: "https://backpack.app/favicon.ico",
    mockAddress: "3f8a...c12d",
  },
  Solflare: {
    chain: "solana",
    icon: "https://solflare.com/favicon.ico",
    mockAddress: "9Qr2...4kLp",
  },
  MetaMask: {
    chain: "evm",
    icon: "https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg",
    mockAddress: "0x1a2b...3c4d",
  },
  "Coinbase Wallet": {
    chain: "evm",
    icon: "https://www.coinbase.com/favicon.ico",
    mockAddress: "0x9f8e...7d6c",
  },
  Xverse: {
    chain: "bitcoin",
    icon: "https://www.xverse.app/favicon.ico",
    mockAddress: "bc1q...x7k2",
  },
  "TAP Wallet": {
    chain: "bitcoin",
    icon: "https://trac.network/favicon.ico",
    mockAddress: "bc1p...m3n8",
  },
};

const MOCK_BALANCES: Record<WalletChain, WalletBalance[]> = {
  solana: [
    { symbol: "USDT", amount: "1,240.50", usdValue: 1240.5, chain: "solana", decimals: 6 },
    { symbol: "SOL", amount: "12.840", usdValue: 2568.0, chain: "solana", decimals: 9 },
  ],
  evm: [
    { symbol: "ETH", amount: "0.5120", usdValue: 1638.4, chain: "evm", decimals: 18 },
    { symbol: "USDT", amount: "850.00", usdValue: 850.0, chain: "evm", decimals: 6 },
  ],
  bitcoin: [
    { symbol: "BTC", amount: "0.14200000", usdValue: 13691.0, chain: "bitcoin", decimals: 8 },
  ],
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connectedWallets, setConnectedWallets] = useState<ConnectedWallet[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = useCallback(async (walletName: string, chain: WalletChain) => {
    setIsConnecting(true);
    try {
      // Simulate connection delay
      await new Promise(r => setTimeout(r, 900));

      const config = WALLET_CONFIGS[walletName];
      if (!config) throw new Error("Unknown wallet");

      // Check if already connected on this chain
      const existing = connectedWallets.find(w => w.chain === chain);
      if (existing) {
        toast.info(`${chain} wallet already connected`, { description: `Disconnect ${existing.name} first` });
        return;
      }

      const wallet: ConnectedWallet = {
        chain,
        name: walletName,
        address: config.mockAddress,
        shortAddress: config.mockAddress,
        icon: config.icon,
        balances: MOCK_BALANCES[chain],
      };

      setConnectedWallets(prev => [...prev, wallet]);
      toast.success(`${walletName} connected`, {
        description: `${config.mockAddress} · ${chain.toUpperCase()}`,
      });
    } catch (err) {
      toast.error("Connection failed", { description: String(err) });
    } finally {
      setIsConnecting(false);
    }
  }, [connectedWallets]);

  const disconnectWallet = useCallback((chain: WalletChain) => {
    setConnectedWallets(prev => {
      const wallet = prev.find(w => w.chain === chain);
      if (wallet) toast.info(`${wallet.name} disconnected`);
      return prev.filter(w => w.chain !== chain);
    });
  }, []);

  const disconnectAll = useCallback(() => {
    setConnectedWallets([]);
    toast.info("All wallets disconnected");
  }, []);

  const totalPortfolioUsd = connectedWallets.reduce(
    (sum, w) => sum + w.balances.reduce((s, b) => s + b.usdValue, 0),
    0
  );

  const primaryWallet = connectedWallets.find(w => w.chain === "solana") ?? connectedWallets[0] ?? null;

  return (
    <WalletContext.Provider value={{
      connectedWallets,
      isConnecting,
      connectWallet,
      disconnectWallet,
      disconnectAll,
      totalPortfolioUsd,
      primaryWallet,
    }}>
      {children}
    </WalletContext.Provider>
  );
}
