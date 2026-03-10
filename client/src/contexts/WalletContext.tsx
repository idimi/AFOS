/**
 * WalletContext — Real Solana wallet integration via @solana/wallet-adapter-react
 * Supports: Phantom, Solflare, Backpack
 * Fetches real on-chain balances from Solana RPC via AFOS backend proxy
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { toast } from "sonner";
import { showWalletDisconnectedToast } from "../components/ConnectWalletModal";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useWallet as useSolanaWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletBalance {
  symbol: string;
  amount: string;
  usdValue: number;
  decimals: number;
  mint?: string;
}

interface WalletContextValue {
  // Solana wallet state
  connected: boolean;
  connecting: boolean;
  publicKey: PublicKey | null;
  walletName: string | null;
  shortAddress: string | null;
  balances: WalletBalance[];
  totalUsd: number;
  balancesLoading: boolean;
  // Actions
  connect: () => void;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  // For signing Jupiter transactions
  signTransaction: ((tx: unknown) => Promise<unknown>) | null;
  sendTransaction: ((tx: unknown, connection: unknown) => Promise<string>) | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

// ─── Token mints on Solana mainnet ──────────────────────────────────────────────
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_DECIMALS = 9;

// ─── Inner provider that uses Solana wallet adapter hooks ─────────────────────
function WalletInner({ children }: { children: ReactNode }) {
  const {
    connected,
    connecting,
    publicKey,
    wallet,
    connect: solanaConnect,
    disconnect: solanaDisconnect,
    signTransaction,
    sendTransaction,
  } = useSolanaWallet();
  const { connection } = useConnection();

  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [prices, setPrices] = useState<{ SOL: number; USDT: number; USDC: number }>({ SOL: 0, USDT: 1, USDC: 1 });

  // Fetch prices from AFOS backend
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch("/api/afos/api/prices");
        if (res.ok) {
          const data = await res.json();
          const p = data.prices || {};
          setPrices({
            SOL: p.SOL?.usd || p.sol?.usd || 0,
            USDT: 1, // stablecoin — always $1.00
            USDC: 1, // stablecoin — always $1.00
          });
        }
      } catch (_) {}
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchBalances = useCallback(async () => {
    if (!publicKey || !connected) {
      setBalances([]);
      return;
    }
    setBalancesLoading(true);
    try {
      const newBalances: WalletBalance[] = [];

      // SOL balance
      const lamports = await connection.getBalance(publicKey);
      const solAmount = lamports / LAMPORTS_PER_SOL;
      newBalances.push({
        symbol: "SOL",
        amount: solAmount.toFixed(4),
        usdValue: solAmount * prices.SOL,
        decimals: SOL_DECIMALS,
      });

      // USDT balance (SPL token)
      try {
        const usdtAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(USDT_MINT),
        });
        const usdtAmount = usdtAccounts.value.length > 0
          ? (usdtAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0)
          : 0;
        newBalances.push({ symbol: "USDT", amount: usdtAmount.toFixed(2), usdValue: usdtAmount, decimals: 6, mint: USDT_MINT });
      } catch (_) {
        newBalances.push({ symbol: "USDT", amount: "0.00", usdValue: 0, decimals: 6, mint: USDT_MINT });
      }

      // USDC balance (SPL token)
      try {
        const usdcAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(USDC_MINT),
        });
        const usdcAmount = usdcAccounts.value.length > 0
          ? (usdcAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0)
          : 0;
        newBalances.push({ symbol: "USDC", amount: usdcAmount.toFixed(2), usdValue: usdcAmount, decimals: 6, mint: USDC_MINT });
      } catch (_) {
        newBalances.push({ symbol: "USDC", amount: "0.00", usdValue: 0, decimals: 6, mint: USDC_MINT });
      }

      setBalances(newBalances);
    } catch (err) {
      console.error("[WalletContext] Failed to fetch balances:", err);
      toast.error("Could not fetch wallet balances");
    } finally {
      setBalancesLoading(false);
    }
  }, [publicKey, connected, connection, prices.SOL]);

  // Fetch balances when wallet connects or prices update
  useEffect(() => {
    if (connected && publicKey) {
      fetchBalances();
    } else {
      setBalances([]);
    }
  }, [connected, publicKey, fetchBalances]);

  const connect = useCallback(async () => {
    try {
      await solanaConnect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("User rejected")) {
        toast.error("Wallet connection failed", { description: msg });
      }
    }
  }, [solanaConnect]);

  const disconnect = useCallback(async () => {
    const walletLabel = wallet?.adapter.name ?? "Solana Wallet";
    await solanaDisconnect();
    setBalances([]);
    showWalletDisconnectedToast(walletLabel, ["solana"]);
  }, [solanaDisconnect, wallet]);

  const shortAddress = publicKey
    ? `${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}`
    : null;

  const totalUsd = balances.reduce((sum, b) => sum + b.usdValue, 0);

  return (
    <WalletContext.Provider
      value={{
        connected,
        connecting,
        publicKey,
        walletName: wallet?.adapter.name || null,
        shortAddress,
        balances,
        totalUsd,
        balancesLoading,
        connect,
        disconnect,
        refreshBalances: fetchBalances,
        signTransaction: signTransaction as ((tx: unknown) => Promise<unknown>) | null,
        sendTransaction: sendTransaction as ((tx: unknown, connection: unknown) => Promise<string>) | null,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ─── Public WalletProvider ─────────────────────────────────────────────────────
export function WalletProvider({ children }: { children: ReactNode }) {
  const network = WalletAdapterNetwork.Mainnet;
  // Use Solana mainnet RPC — configurable via VITE_SOL_RPC_URL env var.
  // The public api.mainnet-beta.solana.com returns 403 Forbidden from browser
  // origins, so we default to a CORS-friendly free RPC (Allnodes publicnode).
  const endpoint = useMemo(
    () => import.meta.env.VITE_SOL_RPC_URL || "https://solana-rpc.publicnode.com",
    []
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletInner>{children}</WalletInner>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
