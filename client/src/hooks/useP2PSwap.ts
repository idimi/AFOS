/**
 * useP2PSwap — P2P HTLC Atomic Swap State Machine
 *
 * Manages the full lifecycle of a P2P atomic swap between two peers.
 * Both sides (Requester = Agent A, Maker = Agent B) use this hook.
 *
 * Correct HTLC Atomic Swap Flow:
 *
 *   REQUESTER (Agent A) — the one who initiates from the Order Book:
 *     1. User clicks "Accept" in Order Book
 *     2. A sends p2p_quote_accepted → B  (notifies B that A wants to proceed)
 *     3. A locks A's funds in HTLC      (locking_a)
 *     4. A sends p2p_htlc_params → B    (secretHash, lockTxHash, timelocks)
 *     5. A waits for B to lock          (waiting_b)
 *     6. A receives p2p_htlc_locked ← B → A is now in "revealing" phase
 *     7. A sends p2p_swap_complete → B  (secret revealed — auto via useEffect)
 *     8. Swap complete
 *
 *   MAKER (Agent B) — the LP peer who receives the RFQ:
 *     1. B receives agent_rfq from server → shown in LightPeerContext UI
 *     2. B clicks "Accept" → B sends p2p_quote_accepted → A (via signalingClient)
 *     3. B receives p2p_htlc_params ← A → B locks B's funds (locking_b)
 *     4. B sends p2p_htlc_locked → A
 *     5. B waits for A to reveal        (locked_b)
 *     6. B receives p2p_swap_complete ← A → B claims with secret (claiming)
 *
 * Signaling messages:
 *   B → A: p2p_quote_accepted   (B accepted A's request, includes B's wallets)
 *   A → B: p2p_htlc_params      (after A locks — secretHash + lockTxHash)
 *   B → A: p2p_htlc_locked      (after B locks)
 *   A → B: p2p_swap_complete    (secret revealed — B can claim)
 *   Either: p2p_swap_failed     (abort)
 *
 * Timeout / Refund:
 *   - A's HTLC has a 2h timelock (timelockA). If B hasn't locked within that window,
 *     A can reclaim their funds. A polls every 30s while in "waiting_b" phase.
 *   - When timelockA expires: A sends p2p_swap_failed to B, then broadcasts a refund tx.
 *
 * Multi-chain support:
 *   - Solana: uses buildSolanaHtlcLockTx + signTransaction
 *   - Ethereum: uses eth_sendTransaction via window.ethereum
 *   - Bitcoin: uses executeBtcHtlcLock from btcHtlc.ts
 *
 * History recording:
 *   - On complete or failed, calls trpc.history.recordP2PSwap to persist the swap.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { getSignalingClient } from "../lib/signalingClient";
import { generateHtlcSecret, buildSolanaHtlcLockTx } from "../lib/solanaHtlc";
import {
  executeBtcHtlcLock,
  executeBtcHtlcLockWithSecretHash,
  detectBtcProvider,
  getBtcAddress,
} from "../lib/btcHtlc";
import { Connection, PublicKey } from "@solana/web3.js";
import { trpc } from "../lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

export type P2PSwapRole = "requester" | "maker";

export type P2PSwapPhase =
  // Requester phases
  | "idle"
  | "accepted"          // Quote accepted, sending p2p_quote_accepted to B
  | "locking_a"         // Agent A signing + broadcasting HTLC lock tx
  | "waiting_b"         // Waiting for Agent B to lock their side
  | "revealing"         // Agent A revealing secret (B has locked)
  | "complete"          // Swap complete
  | "failed"            // Swap failed / aborted
  | "refunding"         // A is broadcasting a refund tx (timeout)
  | "refunded"          // A's HTLC refunded successfully
  // Maker phases
  | "received_params"   // Received HTLC params from Agent A
  | "locking_b"         // Agent B signing + broadcasting HTLC lock tx
  | "locked_b"          // Agent B locked, waiting for A to reveal
  | "claiming";         // Agent B claiming with secret

export interface P2PSwapState {
  rfqId: string;
  role: P2PSwapRole;
  phase: P2PSwapPhase;
  counterpartyPeerId: string;
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  /** Counterparty wallet addresses — populated from p2p_quote_accepted or passed in */
  counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
  // HTLC data (populated as swap progresses)
  secretHash?: string;
  secret?: string;
  lockTxHashA?: string;
  lockTxHashB?: string;
  escrowAddressA?: string;
  escrowAddressB?: string;
  revealTxHash?: string;
  claimTxHash?: string;
  /** Unix timestamp (seconds) when A's HTLC expires — used for timeout/refund polling */
  timelockA?: number;
  /** Unix timestamp (seconds) when B's HTLC expires */
  timelockB?: number;
  /** Wallet address of the user running this side (for history recording) */
  walletAddress?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface UseP2PSwapReturn {
  swap: P2PSwapState | null;
  /** Agent A: initiate swap after accepting a quote from the order book */
  initiateAsRequester: (params: {
    rfqId: string;
    counterpartyPeerId: string;
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    walletPublicKey: string;
    /** B's wallet addresses from the signaling peer registry */
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
    signTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>;
    connection: Connection;
  }) => Promise<void>;
  /** Agent B: initiate HTLC lock after receiving p2p_htlc_params */
  initiateAsMaker: (params: {
    rfqId: string;
    counterpartyPeerId: string;
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    secretHash: string;
    lockTxHashA: string;
    escrowAddressA: string;
    timelockB: number;
    walletPublicKey: string;
    /** A's wallet addresses — used as HTLC recipient so A can claim */
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
    signTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>;
    connection: Connection;
  }) => Promise<void>;
  dismiss: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useP2PSwap(options?: {
  /** Number of Solana slots before A can reclaim (default 144 ≈ 2.4h) */
  timelockSolBlocks?: number;
  /** Number of Ethereum blocks before A can reclaim (default 50 ≈ 10min) */
  timelockEthBlocks?: number;
  /** Number of Bitcoin blocks before A can reclaim (default 6 ≈ 60min) */
  timelockBtcBlocks?: number;
}): UseP2PSwapReturn {
  // ── Derive timelock durations in seconds from block counts ─────────────────
  // Solana: ~0.6s/slot → 144 slots ≈ 86s ≈ 1.4 min (demo) but use 2h default for safety
  // Ethereum: ~12s/block → 50 blocks ≈ 600s ≈ 10 min
  // Bitcoin: ~600s/block → 6 blocks ≈ 3600s ≈ 60 min
  const SOL_SLOT_MS = 600;   // ~0.6s per slot
  const ETH_BLOCK_MS = 12_000; // ~12s per block
  const BTC_BLOCK_MS = 600_000; // ~10min per block
  const timelockSolSec = Math.round(((options?.timelockSolBlocks ?? 144) * SOL_SLOT_MS) / 1000);
  const timelockEthSec = Math.round(((options?.timelockEthBlocks ?? 50) * ETH_BLOCK_MS) / 1000);
  const timelockBtcSec = Math.round(((options?.timelockBtcBlocks ?? 6) * BTC_BLOCK_MS) / 1000);
  // B always gets half of A's window so B must claim before A can refund
  const getTimelocks = (chain: string): { timelockA: number; timelockB: number } => {
    const now = Math.floor(Date.now() / 1000);
    const c = chain.toLowerCase();
    if (c === "ethereum" || c === "eth") {
      return { timelockA: now + timelockEthSec, timelockB: now + Math.round(timelockEthSec / 2) };
    }
    if (c === "bitcoin" || c === "btc") {
      return { timelockA: now + timelockBtcSec, timelockB: now + Math.round(timelockBtcSec / 2) };
    }
    // Default: Solana
    return { timelockA: now + timelockSolSec, timelockB: now + Math.round(timelockSolSec / 2) };
  };

  const [swap, setSwap] = useState<P2PSwapState | null>(null);
  const swapRef = useRef<P2PSwapState | null>(null);
  swapRef.current = swap;

  // tRPC mutation for recording swaps in history
  const recordSwap = trpc.history.recordP2PSwap.useMutation();
  const recordSwapRef = useRef(recordSwap.mutate);
  recordSwapRef.current = recordSwap.mutate;

  // ── Auto-reveal: when A is in "revealing" phase, send secret to B ─────────
  // This fires automatically after p2p_htlc_locked is received from B.
  // The secret was stored in state during locking_a and is now revealed.
  useEffect(() => {
    if (!swap) return;
    if (swap.role !== "requester") return;
    if (swap.phase !== "revealing") return;
    if (!swap.secret) return;

    const client = getSignalingClient();
    const { rfqId, counterpartyPeerId, secret } = swap;

    // Send secret to B so B can claim their side of the HTLC
    client.sendP2PSwapComplete(counterpartyPeerId, { rfqId, secret });

    // Mark as complete on A's side
    const completedAt = Date.now();
    setSwap(prev => prev ? { ...prev, phase: "complete", completedAt } : prev);

    toast.success("Atomic swap complete!", {
      description: "Secret revealed — both sides can now claim their funds.",
      duration: 8000,
    });

    window.dispatchEvent(new CustomEvent("afos:p2p-swap-complete", {
      detail: { rfqId, secret },
    }));

    // Record in history
    const s = swap;
    recordSwapRef.current({
      rfqId: s.rfqId,
      role: "requester",
      status: "completed",
      fromChain: s.fromChain as "bitcoin" | "ethereum" | "solana",
      toChain: s.toChain as "bitcoin" | "ethereum" | "solana",
      fromToken: s.fromToken,
      toToken: s.toToken,
      fromAmount: s.fromAmount,
      toAmount: s.toAmount,
      rate: s.rate,
      peerId: s.counterpartyPeerId,
      walletAddress: s.walletAddress,
      lockTxHashA: s.lockTxHashA,
      escrowAddressA: s.escrowAddressA,
      secretHash: s.secretHash,
      timelockA: s.timelockA,
      timelockB: s.timelockB,
      settlementMs: completedAt - s.startedAt,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap?.phase, swap?.role, swap?.secret]);

  // ── Timeout/refund polling: when A is waiting for B and timelockA expires ──
  // Polls every 30s. When timelockA has passed, sends p2p_swap_failed to B
  // and attempts to broadcast a refund transaction.
  useEffect(() => {
    if (!swap) return;
    if (swap.role !== "requester") return;
    if (swap.phase !== "waiting_b") return;
    if (!swap.timelockA) return;

    const checkTimeout = async () => {
      const current = swapRef.current;
      if (!current || current.phase !== "waiting_b") return;
      if (!current.timelockA) return;

      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < current.timelockA) return; // Not expired yet

      // Timelock expired — B never locked. Initiate refund.
      const client = getSignalingClient();
      client.sendP2PSwapFailed(current.counterpartyPeerId, {
        rfqId: current.rfqId,
        reason: "HTLC timelock expired — requester reclaiming funds",
      });

      setSwap(prev => prev ? { ...prev, phase: "refunding" } : prev);
      toast.warning("HTLC timelock expired", {
        description: "LP did not lock in time. Reclaiming your funds…",
      });

      // Attempt on-chain refund based on chain
      try {
        const chain = current.fromChain.toLowerCase();
        if (chain === "solana") {
          // For Solana: the HTLC program's refund instruction requires the timelock to have passed.
          // If no program is deployed, the PDA funds are locked (demo/testnet limitation).
          // With the Anchor program, call the `refund` instruction.
          const htlcProgramId = import.meta.env.VITE_HTLC_PROGRAM_ID as string | undefined;
          if (htlcProgramId && current.escrowAddressA && current.walletAddress) {
            toast.info("Broadcasting Solana HTLC refund…", {
              description: "This requires your wallet signature.",
            });
            // Dispatch event so Swaps.tsx / ChatPage can handle the wallet signing
            window.dispatchEvent(new CustomEvent("afos:p2p-refund-needed", {
              detail: {
                rfqId: current.rfqId,
                chain: "solana",
                escrowAddress: current.escrowAddressA,
                secretHash: current.secretHash,
                walletAddress: current.walletAddress,
              },
            }));
          } else {
            toast.info("Solana HTLC refund", {
              description: "Deploy the Anchor HTLC program to enable automatic refunds. Contact support if funds are stuck.",
            });
          }
        } else if (chain === "ethereum" || chain === "eth") {
          // ETH HTLC refund: call refund() on the HTLC contract
          const htlcAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;
          if (htlcAddress && current.secretHash && current.walletAddress) {
            const rawEth = (window as unknown as {
              ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> }
            }).ethereum;
            if (rawEth) {
              // refund(bytes32 secretHash) selector: 0x7249fbb6
              const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
              const calldata = "0x7249fbb6" + padLeft(current.secretHash, 32);
              const refundTxHash = await rawEth.request({
                method: "eth_sendTransaction",
                params: [{ from: current.walletAddress, to: htlcAddress, data: calldata, gas: "0x186A0" }],
              });
              setSwap(prev => prev ? {
                ...prev,
                phase: "refunded",
                completedAt: Date.now(),
                revealTxHash: refundTxHash as string,
              } : prev);
              toast.success("ETH HTLC refunded", {
                description: `Tx: ${(refundTxHash as string).slice(0, 16)}…`,
              });
              recordSwapRef.current({
                rfqId: current.rfqId,
                role: "requester",
                status: "refunded",
                fromChain: current.fromChain as "bitcoin" | "ethereum" | "solana",
                toChain: current.toChain as "bitcoin" | "ethereum" | "solana",
                fromToken: current.fromToken,
                toToken: current.toToken,
                fromAmount: current.fromAmount,
                toAmount: current.toAmount,
                rate: current.rate,
                peerId: current.counterpartyPeerId,
                walletAddress: current.walletAddress,
                lockTxHashA: current.lockTxHashA,
                secretHash: current.secretHash,
              });
              return;
            }
          }
          toast.warning("ETH HTLC refund", {
            description: "Set VITE_ETH_HTLC_ADDRESS to enable automatic refunds.",
          });
        } else if (chain === "bitcoin") {
          // BTC HTLC refund: broadcast refund PSBT after timelock
          toast.info("Bitcoin HTLC refund", {
            description: "Your BTC HTLC will be refundable after the timelock block height. Use a Bitcoin wallet to broadcast the refund PSBT.",
          });
        }

        setSwap(prev => prev ? { ...prev, phase: "refunded", completedAt: Date.now() } : prev);
        recordSwapRef.current({
          rfqId: current.rfqId,
          role: "requester",
          status: "refunded",
          fromChain: current.fromChain as "bitcoin" | "ethereum" | "solana",
          toChain: current.toChain as "bitcoin" | "ethereum" | "solana",
          fromToken: current.fromToken,
          toToken: current.toToken,
          fromAmount: current.fromAmount,
          toAmount: current.toAmount,
          rate: current.rate,
          peerId: current.counterpartyPeerId,
          walletAddress: current.walletAddress,
          lockTxHashA: current.lockTxHashA,
          secretHash: current.secretHash,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error("Refund failed", { description: msg.slice(0, 120) });
        setSwap(prev => prev ? { ...prev, phase: "failed", error: `Refund failed: ${msg}`, completedAt: Date.now() } : prev);
      }
    };

    // Check immediately, then every 30s
    checkTimeout();
    const interval = setInterval(checkTimeout, 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap?.phase, swap?.role, swap?.timelockA]);

  // ── Listen for incoming P2P signaling messages ────────────────────────────
  useEffect(() => {
    const client = getSignalingClient();

    // ── A receives p2p_quote_accepted from B ─────────────────────────────────
    // B accepted A's request. Store B's wallet addresses for use as HTLC recipient.
    // Always dispatch window event so ChatPage (which may not have swap state yet) can react.
    const unsubQuoteAccepted = client.on("p2p_quote_accepted", (data) => {
      const msg = data as {
        rfqId: string;
        fromPeerId?: string;
        wallets?: { solana?: string; ethereum?: string; bitcoin?: string };
      };
      // Dispatch unconditionally — ChatPage listens for this to initiate HTLC lock
      window.dispatchEvent(new CustomEvent("afos:p2p-quote-accepted", {
        detail: { rfqId: msg.rfqId, fromPeerId: msg.fromPeerId, walletAddresses: msg.wallets },
      }));
      const current = swapRef.current;
      if (!current || current.rfqId !== msg.rfqId) return;
      if (current.role !== "requester") return;

      if (msg.wallets) {
        setSwap(prev => prev ? {
          ...prev,
          counterpartyWallets: { ...prev.counterpartyWallets, ...msg.wallets },
        } : prev);
      }
    });

    // ── B receives p2p_htlc_params from A → B needs to lock their side ───────
    const unsubParams = client.on("p2p_htlc_params", (data) => {
      const msg = data as {
        rfqId: string;
        fromPeerId?: string;
        secretHash: string;
        lockTxHash: string;
        lockChain: string;
        escrowAddress: string;
        lockedAmount: number;
        lockedToken: string;
        timelockA: number;
        timelockB: number;
        requesterWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
      };
      const current = swapRef.current;
      if (!current || current.rfqId !== msg.rfqId) return;
      if (current.role !== "maker") return;

      setSwap(prev => prev ? {
        ...prev,
        phase: "received_params",
        secretHash: msg.secretHash,
        lockTxHashA: msg.lockTxHash,
        escrowAddressA: msg.escrowAddress,
        timelockA: msg.timelockA,
        timelockB: msg.timelockB,
        counterpartyWallets: msg.requesterWallets ?? prev.counterpartyWallets,
      } : prev);

      // Dispatch event so LightPeerContext can prompt B to lock
      window.dispatchEvent(new CustomEvent("afos:p2p-htlc-params", { detail: msg }));
    });

    // ── A receives p2p_htlc_locked from B → move to revealing phase ──────────
    const unsubLocked = client.on("p2p_htlc_locked", (data) => {
      const msg = data as {
        rfqId: string;
        fromPeerId?: string;
        lockTxHash: string;
        lockChain: string;
        escrowAddress: string;
        lockedAmount: number;
        lockedToken: string;
      };
      const current = swapRef.current;
      if (!current || current.rfqId !== msg.rfqId) return;
      if (current.role !== "requester") return;

      setSwap(prev => prev ? {
        ...prev,
        phase: "revealing",
        lockTxHashB: msg.lockTxHash,
        escrowAddressB: msg.escrowAddress,
      } : prev);

      toast.info("LP locked their side!", {
        description: `Tx: ${msg.lockTxHash.slice(0, 16)}… · Revealing secret to complete swap`,
      });

      window.dispatchEvent(new CustomEvent("afos:p2p-htlc-locked", { detail: msg }));
    });

    // ── B receives p2p_swap_complete from A → B can claim with secret ────────
    const unsubComplete = client.on("p2p_swap_complete", (data) => {
      const msg = data as { rfqId: string; secret: string; revealTxHash?: string };
      const current = swapRef.current;
      if (!current || current.rfqId !== msg.rfqId) return;
      if (current.role !== "maker") return;

      setSwap(prev => prev ? {
        ...prev,
        phase: "claiming",
        secret: msg.secret,
        revealTxHash: msg.revealTxHash,
      } : prev);

      toast.success("Secret received — claiming your funds!", {
        description: `Secret: ${msg.secret.slice(0, 16)}…`,
      });

      window.dispatchEvent(new CustomEvent("afos:p2p-swap-complete", { detail: msg }));

      // Record maker's side in history
      recordSwapRef.current({
        rfqId: current.rfqId,
        role: "maker",
        status: "completed",
        fromChain: current.fromChain as "bitcoin" | "ethereum" | "solana",
        toChain: current.toChain as "bitcoin" | "ethereum" | "solana",
        fromToken: current.fromToken,
        toToken: current.toToken,
        fromAmount: current.fromAmount,
        toAmount: current.toAmount,
        rate: current.rate,
        peerId: current.counterpartyPeerId,
        walletAddress: current.walletAddress,
        lockTxHashB: current.lockTxHashB,
        escrowAddressB: current.escrowAddressB,
        secretHash: current.secretHash,
        timelockB: current.timelockB,
        settlementMs: Date.now() - current.startedAt,
      });
    });

    // ── Either side receives failure ──────────────────────────────────────────
    const unsubFailed = client.on("p2p_swap_failed", (data) => {
      const msg = data as { rfqId: string; reason: string };
      const current = swapRef.current;
      if (!current || current.rfqId !== msg.rfqId) return;

      setSwap(prev => prev ? {
        ...prev,
        phase: "failed",
        error: msg.reason,
        completedAt: Date.now(),
      } : prev);

      toast.error("P2P swap failed", { description: msg.reason });

      // Record failure in history
      recordSwapRef.current({
        rfqId: current.rfqId,
        role: current.role,
        status: "failed",
        fromChain: current.fromChain as "bitcoin" | "ethereum" | "solana",
        toChain: current.toChain as "bitcoin" | "ethereum" | "solana",
        fromToken: current.fromToken,
        toToken: current.toToken,
        fromAmount: current.fromAmount,
        toAmount: current.toAmount,
        rate: current.rate,
        peerId: current.counterpartyPeerId,
        walletAddress: current.walletAddress,
        lockTxHashA: current.lockTxHashA,
        lockTxHashB: current.lockTxHashB,
        secretHash: current.secretHash,
        errorReason: msg.reason,
      });
    });

    return () => {
      unsubQuoteAccepted();
      unsubParams();
      unsubLocked();
      unsubComplete();
      unsubFailed();
    };
  }, []);

  // ── Agent A: initiate swap ────────────────────────────────────────────────
  // Called when user clicks "Accept" in the Order Book.
  // Step 1: Set state to "accepted"
  // Step 2: Generate secret + lock A's HTLC
  // Step 3: Send p2p_htlc_params to B
  // Step 4: Wait for p2p_htlc_locked from B (handled in useEffect above)
  // Step 5: Reveal secret (handled by auto-reveal useEffect above)
  const initiateAsRequester = useCallback(async (params: {
    rfqId: string;
    counterpartyPeerId: string;
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    walletPublicKey: string;
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
    signTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>;
    connection: Connection;
  }) => {
    const client = getSignalingClient();

    setSwap({
      rfqId: params.rfqId,
      role: "requester",
      phase: "accepted",
      counterpartyPeerId: params.counterpartyPeerId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.fromAmount,
      toAmount: params.toAmount,
      rate: params.rate,
      counterpartyWallets: params.counterpartyWallets,
      walletAddress: params.walletPublicKey,
      startedAt: Date.now(),
    });

    try {
      // ── Step 1: Generate secret ─────────────────────────────────────────
      const { secretHex, secretHashHex } = await generateHtlcSecret();
      setSwap(prev => prev ? { ...prev, phase: "locking_a", secretHash: secretHashHex } : prev);

      // ── Step 2: Lock A's funds ──────────────────────────────────────────
      const chain = params.fromChain.toLowerCase();

      if (chain === "solana") {
        const senderPubkey = new PublicKey(params.walletPublicKey);
        // A gets configurable timelock, B gets half (B must claim before A can refund)
        const { timelockA, timelockB } = getTimelocks("solana");

        // Use B's Solana wallet as recipient if available
        const recipientStr = params.counterpartyWallets?.solana ?? params.walletPublicKey;
        let recipientPubkey: PublicKey;
        try {
          recipientPubkey = new PublicKey(recipientStr);
        } catch {
          recipientPubkey = senderPubkey;
        }

        const { transaction, escrowAddress } = await buildSolanaHtlcLockTx({
          senderPubkey,
          recipientPubkey,
          amountSol: params.fromAmount,
          secretHash: secretHashHex,
          timelock: timelockA,
          connection: params.connection,
        });

        const signedTx = await params.signTransaction(transaction);
        const rawTx = signedTx.serialize();
        const lockTxHash = await params.connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        // Store secret + timelocks in state — the auto-reveal useEffect will send it when B locks
        setSwap(prev => prev ? {
          ...prev,
          phase: "waiting_b",
          lockTxHashA: lockTxHash,
          escrowAddressA: escrowAddress,
          secret: secretHex,
          timelockA,
          timelockB,
        } : prev);

        toast.success("Your funds locked in HTLC", {
          description: `Tx: ${lockTxHash.slice(0, 16)}… · Waiting for LP to lock their side`,
          action: {
            label: "Solscan",
            onClick: () => window.open(`https://solscan.io/tx/${lockTxHash}`, "_blank"),
          },
        });

        // ── Step 3: Send HTLC params to B ──────────────────────────────
        client.sendP2PHtlcParams(params.counterpartyPeerId, {
          rfqId: params.rfqId,
          secretHash: secretHashHex,
          lockTxHash,
          lockChain: "solana",
          escrowAddress,
          lockedAmount: params.fromAmount,
          lockedToken: params.fromToken,
          timelockA,
          timelockB,
        });

      } else if (chain === "ethereum" || chain === "eth") {
        const rawEth = (window as unknown as {
          ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> }
        }).ethereum;
        if (!rawEth) throw new Error("No Ethereum wallet provider found");

        const { timelockA, timelockB } = getTimelocks("ethereum");
        const amountWei = BigInt(Math.floor(params.fromAmount * 1e18));
        const htlcAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;
        const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
        const calldata = "0x1d4e5e8c"
          + padLeft(secretHashHex, 32)
          + padLeft(params.walletPublicKey.replace(/^0x/, "").toLowerCase(), 32)
          + padLeft(timelockA.toString(16), 32);

        const lockTxHash = await rawEth.request({
          method: "eth_sendTransaction",
          params: [{
            from: params.walletPublicKey,
            to: htlcAddress ?? params.walletPublicKey,
            value: "0x" + amountWei.toString(16),
            data: htlcAddress ? calldata : `0x48544c43${params.rfqId.replace(/-/g, "").slice(0, 32)}`,
            gas: htlcAddress ? "0x186A0" : "0x5208",
          }],
        });

        setSwap(prev => prev ? {
          ...prev,
          phase: "waiting_b",
          lockTxHashA: lockTxHash as string,
          secret: secretHex,
          timelockA,
          timelockB,
        } : prev);

        toast.success("ETH locked in HTLC", {
          description: `Tx: ${(lockTxHash as string).slice(0, 16)}… · Waiting for LP`,
        });

        client.sendP2PHtlcParams(params.counterpartyPeerId, {
          rfqId: params.rfqId,
          secretHash: secretHashHex,
          lockTxHash: lockTxHash as string,
          lockChain: "ethereum",
          escrowAddress: htlcAddress ?? params.walletPublicKey,
          lockedAmount: params.fromAmount,
          lockedToken: params.fromToken,
          timelockA,
          timelockB,
        });

      } else if (chain === "bitcoin" || chain === "btc") {
        // ── Bitcoin HTLC lock ───────────────────────────────────────────
        const provider = detectBtcProvider();
        const btcAddress = await getBtcAddress(provider);
        if (!btcAddress) throw new Error("No Bitcoin wallet connected. Please connect a BTC wallet.");

        const { timelockA, timelockB } = getTimelocks("bitcoin");
        const amountSats = Math.round(params.fromAmount * 1e8);

        // Use B's BTC pubkey as recipient if available, otherwise use sender's pubkey
        const recipientPubKey = params.counterpartyWallets?.bitcoin ?? params.walletPublicKey;
        const senderPubKey = params.walletPublicKey;

        const { txid, htlcAddress, secret, secretHash } = await executeBtcHtlcLock(
          btcAddress,
          recipientPubKey,
          senderPubKey,
          amountSats,
          2, // 2 hours
          provider,
          "mainnet",
        );

        setSwap(prev => prev ? {
          ...prev,
          phase: "waiting_b",
          lockTxHashA: txid,
          escrowAddressA: htlcAddress,
          secret,
          secretHash,
          timelockA,
          timelockB,
        } : prev);

        toast.success("BTC locked in HTLC", {
          description: `Tx: ${txid.slice(0, 16)}… · Waiting for LP to lock their side`,
          action: {
            label: "Mempool",
            onClick: () => window.open(`https://mempool.space/tx/${txid}`, "_blank"),
          },
        });

        client.sendP2PHtlcParams(params.counterpartyPeerId, {
          rfqId: params.rfqId,
          secretHash,
          lockTxHash: txid,
          lockChain: "bitcoin",
          escrowAddress: htlcAddress,
          lockedAmount: params.fromAmount,
          lockedToken: params.fromToken,
          timelockA,
          timelockB,
        });

      } else {
        throw new Error(
          `HTLC locking for ${chain} requires a connected ${chain} wallet. ` +
          `Please connect your wallet and try again.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejected = msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel");

      setSwap(prev => prev ? {
        ...prev,
        phase: "failed",
        error: isRejected ? "Transaction rejected by user" : msg,
        completedAt: Date.now(),
      } : prev);

      if (!isRejected) {
        toast.error("HTLC lock failed", { description: msg.slice(0, 120) });
      }

      client.sendP2PSwapFailed(params.counterpartyPeerId, {
        rfqId: params.rfqId,
        reason: isRejected ? "Requester rejected transaction" : msg.slice(0, 120),
      });

      // Record failure in history
      recordSwapRef.current({
        rfqId: params.rfqId,
        role: "requester",
        status: "failed",
        fromChain: params.fromChain as "bitcoin" | "ethereum" | "solana",
        toChain: params.toChain as "bitcoin" | "ethereum" | "solana",
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        toAmount: params.toAmount,
        rate: params.rate,
        peerId: params.counterpartyPeerId,
        walletAddress: params.walletPublicKey,
        errorReason: msg.slice(0, 200),
      });
    }
  }, []);

  // ── Agent B: lock B's side of the HTLC ───────────────────────────────────
  // Called when B receives p2p_htlc_params from A.
  // B locks the "to" token (what B owes A) and sends p2p_htlc_locked to A.
  const initiateAsMaker = useCallback(async (params: {
    rfqId: string;
    counterpartyPeerId: string;
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    secretHash: string;
    lockTxHashA: string;
    escrowAddressA: string;
    timelockB: number;
    walletPublicKey: string;
    counterpartyWallets?: { solana?: string; ethereum?: string; bitcoin?: string };
    signTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>;
    connection: Connection;
  }) => {
    const client = getSignalingClient();

    setSwap(prev => prev ? { ...prev, phase: "locking_b" } : {
      rfqId: params.rfqId,
      role: "maker",
      phase: "locking_b",
      counterpartyPeerId: params.counterpartyPeerId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.fromAmount,
      toAmount: params.toAmount,
      rate: params.rate,
      secretHash: params.secretHash,
      lockTxHashA: params.lockTxHashA,
      escrowAddressA: params.escrowAddressA,
      timelockB: params.timelockB,
      counterpartyWallets: params.counterpartyWallets,
      walletAddress: params.walletPublicKey,
      startedAt: Date.now(),
    });

    try {
      const chain = params.toChain.toLowerCase(); // B locks the "to" token

      if (chain === "solana") {
        const senderPubkey = new PublicKey(params.walletPublicKey);

        // Use A's Solana wallet as recipient so A can claim
        const recipientStr = params.counterpartyWallets?.solana ?? params.walletPublicKey;
        let recipientPubkey: PublicKey;
        try {
          recipientPubkey = new PublicKey(recipientStr);
        } catch {
          recipientPubkey = senderPubkey;
        }

        const { transaction, escrowAddress } = await buildSolanaHtlcLockTx({
          senderPubkey,
          recipientPubkey,
          amountSol: params.toAmount,
          secretHash: params.secretHash,
          timelock: params.timelockB,
          connection: params.connection,
        });

        const signedTx = await params.signTransaction(transaction);
        const rawTx = signedTx.serialize();
        const lockTxHash = await params.connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        setSwap(prev => prev ? {
          ...prev,
          phase: "locked_b",
          lockTxHashB: lockTxHash,
          escrowAddressB: escrowAddress,
        } : prev);

        toast.success("Your side locked in HTLC", {
          description: `Tx: ${lockTxHash.slice(0, 16)}… · Waiting for requester to reveal secret`,
          action: {
            label: "Solscan",
            onClick: () => window.open(`https://solscan.io/tx/${lockTxHash}`, "_blank"),
          },
        });

        // Notify A that B has locked — A's auto-reveal useEffect will fire
        client.sendP2PHtlcLocked(params.counterpartyPeerId, {
          rfqId: params.rfqId,
          lockTxHash,
          lockChain: "solana",
          escrowAddress,
          lockedAmount: params.toAmount,
          lockedToken: params.toToken,
        });

      } else if (chain === "ethereum" || chain === "eth") {
        const rawEth = (window as unknown as {
          ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> }
        }).ethereum;
        if (!rawEth) throw new Error("No Ethereum wallet provider found");

        const amountWei = BigInt(Math.floor(params.toAmount * 1e18));
        const htlcAddress = import.meta.env.VITE_ETH_HTLC_ADDRESS as string | undefined;
        const padLeft = (hex: string, bytes = 32) => hex.padStart(bytes * 2, "0");
        const calldata = "0x1d4e5e8c"
          + padLeft(params.secretHash, 32)
          + padLeft(params.walletPublicKey.replace(/^0x/, "").toLowerCase(), 32)
          + padLeft(params.timelockB.toString(16), 32);

        const lockTxHash = await rawEth.request({
          method: "eth_sendTransaction",
          params: [{
            from: params.walletPublicKey,
            to: htlcAddress ?? params.walletPublicKey,
            value: "0x" + amountWei.toString(16),
            data: htlcAddress ? calldata : `0x48544c43${params.rfqId.replace(/-/g, "").slice(0, 32)}`,
            gas: htlcAddress ? "0x186A0" : "0x5208",
          }],
        });

        setSwap(prev => prev ? {
          ...prev,
          phase: "locked_b",
          lockTxHashB: lockTxHash as string,
        } : prev);

        toast.success("ETH locked on your side", {
          description: `Tx: ${(lockTxHash as string).slice(0, 16)}…`,
        });

        client.sendP2PHtlcLocked(params.counterpartyPeerId, {
          rfqId: params.rfqId,
          lockTxHash: lockTxHash as string,
          lockChain: "ethereum",
          escrowAddress: htlcAddress ?? params.walletPublicKey,
          lockedAmount: params.toAmount,
          lockedToken: params.toToken,
        });

      } else if (chain === "bitcoin" || chain === "btc") {
        // ── Bitcoin HTLC lock for Maker ─────────────────────────────────
        // B MUST use A's secretHash so A can claim B's HTLC with the same secret
        const provider = detectBtcProvider();
        const btcAddress = await getBtcAddress(provider);
        if (!btcAddress) throw new Error("No Bitcoin wallet connected. Please connect a BTC wallet.");

        const amountSats = Math.round(params.toAmount * 1e8);

        // Use A's BTC pubkey as recipient so A can claim B's HTLC
        const recipientPubKey = params.counterpartyWallets?.bitcoin ?? params.walletPublicKey;
        const senderPubKey = params.walletPublicKey;

        const { txid, htlcAddress, witnessScript } = await executeBtcHtlcLockWithSecretHash(
          btcAddress,
          recipientPubKey,
          senderPubKey,
          amountSats,
          params.secretHash, // Use A's secretHash — critical for atomic swap!
          1, // 1 hour (B's timelock is shorter than A's)
          provider,
          "mainnet",
        );

        setSwap(prev => prev ? {
          ...prev,
          phase: "locked_b",
          lockTxHashB: txid,
          escrowAddressB: htlcAddress,
        } : prev);

        toast.success("BTC locked on your side", {
          description: `Tx: ${txid.slice(0, 16)}… · Waiting for requester to reveal secret`,
          action: {
            label: "Mempool",
            onClick: () => window.open(`https://mempool.space/tx/${txid}`, "_blank"),
          },
        });

        // Store witnessScript for later claim (needed to spend the HTLC output)
        window.sessionStorage.setItem(`btc-htlc-witness-${params.rfqId}`, witnessScript);

        client.sendP2PHtlcLocked(params.counterpartyPeerId, {
          rfqId: params.rfqId,
          lockTxHash: txid,
          lockChain: "bitcoin",
          escrowAddress: htlcAddress,
          lockedAmount: params.toAmount,
          lockedToken: params.toToken,
        });

      } else {
        throw new Error(`HTLC locking for ${chain} requires a connected ${chain} wallet.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejected = msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel");

      setSwap(prev => prev ? {
        ...prev,
        phase: "failed",
        error: isRejected ? "Transaction rejected by user" : msg,
        completedAt: Date.now(),
      } : prev);

      if (!isRejected) {
        toast.error("HTLC lock failed", { description: msg.slice(0, 120) });
      }

      client.sendP2PSwapFailed(params.counterpartyPeerId, {
        rfqId: params.rfqId,
        reason: isRejected ? "Maker rejected transaction" : msg.slice(0, 120),
      });

      // Record failure in history
      recordSwapRef.current({
        rfqId: params.rfqId,
        role: "maker",
        status: "failed",
        fromChain: params.fromChain as "bitcoin" | "ethereum" | "solana",
        toChain: params.toChain as "bitcoin" | "ethereum" | "solana",
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        toAmount: params.toAmount,
        rate: params.rate,
        peerId: params.counterpartyPeerId,
        walletAddress: params.walletPublicKey,
        lockTxHashA: params.lockTxHashA,
        secretHash: params.secretHash,
        errorReason: msg.slice(0, 200),
      });
    }
  }, []);

  const dismiss = useCallback(() => {
    setSwap(null);
  }, []);

  return { swap, initiateAsRequester, initiateAsMaker, dismiss };
}
