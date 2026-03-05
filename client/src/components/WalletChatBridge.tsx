/**
 * WalletChatBridge — Watches wallet connection state and auto-clears
 * the shared chat conversation when all wallets disconnect (privacy).
 *
 * Must be rendered inside both WalletProvider/MultiChainWalletProvider AND ChatProvider.
 */
import { useEffect, useRef } from "react";
import { useWallet } from "../contexts/WalletContext";
import { useMultiChainWallet } from "../contexts/MultiChainWalletContext";
import { useChat } from "../contexts/ChatContext";

export function WalletChatBridge() {
  const { connected: solConnected } = useWallet();
  const { ethereum, bitcoin, phantomMultiChain } = useMultiChainWallet();

  const { clearMessages } = useChat();

  const anyConnected =
    solConnected ||
    !!phantomMultiChain?.connected ||
    !!ethereum?.connected ||
    !!bitcoin?.connected;

  // Track previous connection state to detect disconnect transitions
  const prevConnected = useRef(anyConnected);

  useEffect(() => {
    // Only clear when transitioning from connected → disconnected
    if (prevConnected.current && !anyConnected) {
      clearMessages(false);
    }
    prevConnected.current = anyConnected;
  }, [anyConnected, clearMessages]);

  return null; // Render nothing — this is a side-effect-only component
}
