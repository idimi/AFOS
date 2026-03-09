/**
 * WalletToastManager — Mounted ONCE in App.tsx.
 * Watches wallet connection state and fires exactly one toast per connection event.
 *
 * This component is the single source of truth for wallet-connected toasts
 * for Phantom, Solflare, MetaMask, Coinbase, and Xverse.
 *
 * Tap Wallet connect/disconnect toasts are handled DIRECTLY in
 * MultiChainWalletContext (connectTapWallet, disconnectBitcoin,
 * disconnectTracNetwork) because the context has access to the raw
 * addresses at the exact moment they're available — no race conditions.
 */
import { useEffect, useRef } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";
import {
  showWalletConnectedToast,
  showWalletDisconnectedToast,
} from "./ConnectWalletModal";

export function WalletToastManager() {
  const { connected: solConnected, walletName: solWalletName, shortAddress: solShortAddr } = useWallet();
  const { ethereum, bitcoin, phantomMultiChain } = useMultiChainWallet();

  // ── Phantom multi-chain connect ──────────────────────────────────────────
  const prevPhantomRef = useRef(phantomMultiChain?.connected ?? false);
  useEffect(() => {
    const was = prevPhantomRef.current;
    const now = phantomMultiChain?.connected ?? false;
    prevPhantomRef.current = now;
    if (!was && now) {
      const addrs: { chain: "solana" | "ethereum" | "bitcoin" | "trac_network"; address: string }[] = [];
      if (phantomMultiChain?.solanaAddress) {
        const a = phantomMultiChain.solanaAddress;
        addrs.push({ chain: "solana", address: `${a.slice(0, 4)}…${a.slice(-4)}` });
      }
      if (phantomMultiChain?.ethereumAddress) {
        const a = phantomMultiChain.ethereumAddress;
        addrs.push({ chain: "ethereum", address: `${a.slice(0, 6)}…${a.slice(-4)}` });
      }
      if (phantomMultiChain?.bitcoinAddress) {
        const a = phantomMultiChain.bitcoinAddress;
        addrs.push({ chain: "bitcoin", address: `${a.slice(0, 6)}…${a.slice(-4)}` });
      }
      if (addrs.length > 0) showWalletConnectedToast("Phantom", addrs);
    }
  }, [phantomMultiChain?.connected]);

  // ── Phantom disconnect ────────────────────────────────────────────────────
  const prevPhantomDisconnRef = useRef(phantomMultiChain?.connected ?? false);
  useEffect(() => {
    const was = prevPhantomDisconnRef.current;
    const now = phantomMultiChain?.connected ?? false;
    prevPhantomDisconnRef.current = now;
    if (was && !now) {
      showWalletDisconnectedToast("Phantom", ["solana", "ethereum", "bitcoin"]);
    }
  }, [phantomMultiChain?.connected]);

  // ── Solana-only (non-Phantom, e.g. Solflare) ─────────────────────────────
  const prevSolRef = useRef(solConnected);
  useEffect(() => {
    const was = prevSolRef.current;
    const now = solConnected;
    prevSolRef.current = now;
    // Skip if Phantom multi-chain is connected (Phantom handles its own toast above)
    if (!was && now && !phantomMultiChain?.connected) {
      showWalletConnectedToast(solWalletName ?? "Solana Wallet", [
        { chain: "solana", address: solShortAddr ?? "" },
      ]);
    }
  }, [solConnected]);

  // ── Ethereum-only (non-Phantom) ───────────────────────────────────────────
  const prevEthRef = useRef(ethereum?.connected ?? false);
  useEffect(() => {
    const was = prevEthRef.current;
    const now = ethereum?.connected ?? false;
    prevEthRef.current = now;
    if (!was && now && !ethereum?.isPhantom) {
      showWalletConnectedToast(ethereum?.walletName ?? "Ethereum Wallet", [
        { chain: "ethereum", address: ethereum?.shortAddress ?? "" },
      ]);
    }
  }, [ethereum?.connected]);

  // ── Bitcoin-only (non-Phantom, non-Tap Wallet, e.g. Xverse) ──────────────
  const prevBtcRef = useRef(bitcoin?.connected ?? false);
  useEffect(() => {
    const was = prevBtcRef.current;
    const now = bitcoin?.connected ?? false;
    prevBtcRef.current = now;
    const isTapWallet = bitcoin?.walletName === "Tap Wallet";
    if (!was && now && !bitcoin?.isPhantom && !isTapWallet) {
      showWalletConnectedToast(bitcoin?.walletName ?? "Bitcoin Wallet", [
        { chain: "bitcoin", address: bitcoin?.shortAddress ?? "" },
      ]);
    }
  }, [bitcoin?.connected]);

  // NOTE: Tap Wallet connect/disconnect toasts are NOT here.
  // They are fired directly in MultiChainWalletContext:
  //   - connectTapWallet() fires ONE combined toast after BOTH setTracNetwork + setBitcoin
  //   - disconnectTracNetwork() / disconnectBitcoin() fire ONE combined toast with ["bitcoin", "trac_network"]

  return null; // Render nothing — side-effect only
}
