/**
 * WalletToastManager — Mounted ONCE in App.tsx.
 * Watches wallet connection state and fires exactly one toast per connection event.
 *
 * This component is the single source of truth for all wallet-connected toasts.
 * By living here (outside ConnectWalletModal), we guarantee one toast fires
 * regardless of how many ConnectWalletModal instances are mounted simultaneously
 * across Dashboard, ChatPage, Swaps, AgentSettings, etc.
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
  const { ethereum, bitcoin, tracNetwork, phantomMultiChain } = useMultiChainWallet();

  // ── Phantom multi-chain ───────────────────────────────────────────────────
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

  // ── Solana-only (non-Phantom, e.g. Solflare) ──────────────────────────────
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

  // ── Bitcoin-only (non-Phantom, non-Tap Wallet) ────────────────────────────
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

  // ── Tap Wallet (BTC + TNK combined) ──────────────────────────────────────
  // We watch tracNetwork?.connected as the "both connected" signal because
  // the context always connects TNK first, then BTC. By the time tracNetwork
  // becomes connected, setBitcoin() has already been called for BTC.
  // We use a small delay (one microtask tick) to let the bitcoin state flush
  // before building the address list.
  const prevTnkRef = useRef(tracNetwork?.connected ?? false);
  const tapToastFiredRef = useRef(false);
  useEffect(() => {
    const was = prevTnkRef.current;
    const now = tracNetwork?.connected ?? false;
    prevTnkRef.current = now;

    if (!was && now) {
      // Reset the "already fired" guard on each new connection
      tapToastFiredRef.current = false;

      // Use a microtask delay so React can flush the bitcoin state update
      // that was dispatched just before tracNetwork was set.
      const id = setTimeout(() => {
        if (tapToastFiredRef.current) return; // guard against double-fire
        tapToastFiredRef.current = true;

        const addrs: { chain: "solana" | "ethereum" | "bitcoin" | "trac_network"; address: string }[] = [];

        // Read bitcoin from the closure — by now setBitcoin() has flushed
        // (we get the latest value via the ref trick below)
        const btcAddr = bitcoinRef.current;
        if (btcAddr) {
          addrs.push({ chain: "bitcoin", address: btcAddr });
        }

        const tnkAddr = tracNetworkRef.current;
        if (tnkAddr) {
          addrs.push({ chain: "trac_network", address: tnkAddr });
        }

        if (addrs.length > 0) {
          showWalletConnectedToast("Tap Wallet", addrs);
        }
      }, 150); // 150ms is enough for React to batch-flush both state updates

      return () => clearTimeout(id);
    }
  }, [tracNetwork?.connected]);

  // Keep refs to latest addresses so the setTimeout closure can read them
  const bitcoinRef = useRef<string | null>(null);
  useEffect(() => {
    if (bitcoin?.connected && bitcoin.walletName === "Tap Wallet") {
      bitcoinRef.current = bitcoin.shortAddress ?? null;
    } else {
      bitcoinRef.current = null;
    }
  }, [bitcoin?.connected, bitcoin?.shortAddress, bitcoin?.walletName]);

  const tracNetworkRef = useRef<string | null>(null);
  useEffect(() => {
    if (tracNetwork?.connected) {
      tracNetworkRef.current = tracNetwork.shortAddress ?? null;
    } else {
      tracNetworkRef.current = null;
    }
  }, [tracNetwork?.connected, tracNetwork?.shortAddress]);

  return null; // Render nothing — side-effect only
}
