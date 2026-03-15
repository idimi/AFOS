/**
 * TapWalletSignCard — Inline chat card for TNK→SOL HTLC signing
 *
 * Shown when buildSwapTx returns route "AFOS TNK→SOL HTLC".
 * Provides three ways for the user to sign the TNK lock transaction:
 *   1. QR code — scan with Tap Wallet mobile app
 *   2. Deep-link button — opens tapwallet://sign?payload=<base64> on mobile
 *   3. Copy button — copies the base64 payload for manual paste
 *   4. Auto-sign via window.tapwallet.tracnetwork.submitContractTx (if available)
 *
 * After the user signs, the card shows a success state with the TNK tx hash.
 * Status is polled every 10s via the rfqId to detect settlement.
 * An expiry countdown timer shows how long the user has to sign before the
 * agent's Solana lock expires and is refunded.
 */
import { useState, useEffect, useCallback } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Copy, Check, ExternalLink, Smartphone, Loader2, CheckCircle2, Clock, AlertTriangle, QrCode, Lock as LockIcon, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface TapWalletSignCardProps {
  /** Optional callback fired when the swap is confirmed as settled (status=completed).
   *  Receives the Solana claim tx signature (revealTxId) so callers can show a Solscan link. */
  onSettled?: (claimTxId?: string) => void;
  /** Base64-encoded Trac Network lock transaction payload */
  tnkLockTxPayload: string;
  /** HTLC ID on Trac Network (htlc_b_<rfqId>) — user locks TNK here */
  htlcIdB: string;
  /** HTLC ID on Solana (htlc_a_<rfqId>) — agent locks SOL/USDT/USDC here */
  htlcIdA: string;
  /** The rfqId for status polling */
  rfqId: string;
  /** Amount of TNK the user is locking */
  tnkAmount?: number;
  /** Amount of SOL/USDT/USDC the user will receive */
  outAmount?: number;
  /** Token the user will receive */
  toToken?: string;
  /** Unix ms — when the agent's Solana HTLC lock expires.
   *  If provided, a live countdown is shown so the user knows how long they have to sign. */
  htlcExpiresAt?: number;
  /** Called when the TNK lock is confirmed on-chain */
  onSigned?: (txHash: string) => void;
  /** Called when the user cancels */
  onCancel?: () => void;
}

type SignState = "pending" | "signing" | "signed" | "settled" | "expired" | "error";

/** Format a remaining-time duration (ms) into a human-readable string like "23h 14m 07s" */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Returns a colour class based on how much time is left */
function countdownColor(ms: number): string {
  if (ms <= 0) return "text-red-400";
  if (ms < 5 * 60 * 1000) return "text-red-400";   // < 5 min — critical
  if (ms < 30 * 60 * 1000) return "text-amber-400"; // < 30 min — warning
  return "text-emerald-400";                          // plenty of time
}

export default function TapWalletSignCard({
  tnkLockTxPayload,
  htlcIdB,
  rfqId,
  tnkAmount,
  outAmount,
  toToken = "SOL",
  htlcExpiresAt,
  onSigned,
  onSettled,
  onCancel,
}: TapWalletSignCardProps) {
  const [signState, setSignState] = useState<SignState>("pending");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [autoSignAttempted, setAutoSignAttempted] = useState(false);

  // ── Expiry countdown ──────────────────────────────────────────────────────────
  const [remainingMs, setRemainingMs] = useState<number | null>(
    htlcExpiresAt ? htlcExpiresAt - Date.now() : null
  );

  useEffect(() => {
    if (!htlcExpiresAt) return;
    // Tick every second while the card is in pending/signing state
    const interval = setInterval(() => {
      const diff = htlcExpiresAt - Date.now();
      setRemainingMs(diff);
      if (diff <= 0 && signState === "pending") {
        setSignState("expired");
        clearInterval(interval);
        toast.error("HTLC expired", {
          description: "The agent's Solana lock has expired and will be refunded. Please start a new swap.",
          duration: 10_000,
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [htlcExpiresAt, signState]);

  // Deep-link URL for Tap Wallet mobile app
  // Format: tapwallet://sign?payload=<base64>&htlcId=<htlcIdB>
  const deepLinkUrl = `tapwallet://sign?payload=${encodeURIComponent(tnkLockTxPayload)}&htlcId=${encodeURIComponent(htlcIdB)}&rfqId=${encodeURIComponent(rfqId)}`;

  // QR code content — same as deep-link so mobile can scan and open Tap Wallet
  const qrContent = deepLinkUrl;

  // Poll for settlement via getHtlcSecretHash (returns status field)
  const htlcStatusQuery = trpc.chat.getHtlcSecretHash.useQuery(
    { rfqId },
    {
      enabled: signState === "signed",
      refetchInterval: 10_000,
      retry: false,
    }
  );

  // Watch for settlement
  useEffect(() => {
    const status = htlcStatusQuery.data?.status;
    if (status === "completed" && signState === "signed") {
      setSignState("settled");
      const claimTxId = htlcStatusQuery.data?.revealTxId ?? undefined;
      onSettled?.(claimTxId ?? undefined);
    }
  }, [htlcStatusQuery.data?.status, signState, onSettled]);

  // Auto-sign via Tap Wallet if available.
  // Tries three APIs in priority order:
  //   1. window.tapwallet.tracnetwork.submitContractTx (newest Tap Wallet API)
  //   2. window.tracnetwork.signTracTx (mid-generation Tap Wallet API)
  //   3. window.tapprotocol.signTracTx (older Tap Wallet API)
  const tryAutoSign = useCallback(async () => {
    if (autoSignAttempted) return;
    setAutoSignAttempted(true);
    type SignFn = (p: unknown) => Promise<{ txHash?: string; success?: boolean; error?: string }>;
    const win = window as unknown as {
      tapwallet?: { tracnetwork?: { submitContractTx?: SignFn } };
      tracnetwork?: { signTracTx?: SignFn };
      tapprotocol?: { signTracTx?: SignFn };
    };
    // Resolve the best available signing function
    const submitFn: SignFn | undefined =
      (win.tapwallet?.tracnetwork?.submitContractTx?.bind(win.tapwallet.tracnetwork)) ??
      (win.tracnetwork?.signTracTx?.bind(win.tracnetwork)) ??
      (win.tapprotocol?.signTracTx?.bind(win.tapprotocol));
    if (!submitFn) return; // Not available — user must use QR/deep-link
    try {
      setSignState("signing");
      const tnkLockData = JSON.parse(Buffer.from(tnkLockTxPayload, "base64").toString("utf-8")) as unknown;
      const result = await submitFn(tnkLockData);
      if (result?.error) throw new Error(result.error);
      const hash = result?.txHash ?? "pending";
      setTxHash(hash);
      setSignState("signed");
      toast.success("TNK lock submitted!", {
        description: `Tx: ${hash.slice(0, 14)}… — ${toToken} will be released automatically.`,
      });
      onSigned?.(hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't set error state — fall back to manual QR/deep-link
      console.warn("[TapWalletSignCard] Auto-sign failed, falling back to manual:", msg);
      setSignState("pending");
      setAutoSignAttempted(false);
    }
  }, [autoSignAttempted, tnkLockTxPayload, toToken, onSigned]);

  // Try auto-sign on mount
  useEffect(() => {
    void tryAutoSign();
  }, [tryAutoSign]);

  // Direct Tap Wallet sign — triggers the wallet popup immediately via sendTNK
  // Used when auto-sign is not available (no submitContractTx/signTracTx API)
  const handleDirectSign = useCallback(async () => {
    const tap = (window as any).tracnetwork ?? (window as any).tapprotocol;
    if (!tap) {
      toast.error("Tap Wallet not detected", {
        description: "Please install the Tap Wallet browser extension.",
      });
      return;
    }
    try {
      setSignState("signing");
      // Parse the payload to extract HTLC parameters
      const tnkLockData = JSON.parse(Buffer.from(tnkLockTxPayload, "base64").toString("utf-8")) as {
        to?: string; amount?: string; secretHash?: string; htlcId?: string;
      };
      const toAddress = tnkLockData.to ?? "";
      const amount = tnkLockData.amount ?? String(tnkAmount ?? 0);
      // Trigger the Tap Wallet popup via sendTNK
      const result = await tap.sendTNK(toAddress, amount);
      if (!result?.success && !result?.txHash) throw new Error(result?.error ?? "TNK send failed");
      const hash = result?.txHash ?? "pending";
      setTxHash(hash);
      setSignState("signed");
      toast.success("TNK lock submitted!", {
        description: `Tx: ${hash.slice(0, 14)}… — ${toToken} will be released automatically.`,
      });
      onSigned?.(hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("cancel")) {
        setSignState("pending");
        toast.info("Transaction cancelled");
      } else {
        setSignState("pending");
        toast.error("TNK sign failed", { description: msg.slice(0, 80) });
      }
    }
  }, [tnkLockTxPayload, tnkAmount, toToken, onSigned]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tnkLockTxPayload);
      setCopied(true);
      toast.success("Payload copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleDeepLink = () => {
    window.open(deepLinkUrl, "_blank");
    toast.info("Opening Tap Wallet…", {
      description: "If Tap Wallet doesn't open, scan the QR code instead.",
    });
  };

  // ── Expired state ─────────────────────────────────────────────────────────────
  if (signState === "expired") {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mt-2">
        <div className="flex items-center gap-2 text-red-400 font-semibold mb-1">
          <AlertTriangle className="w-4 h-4" />
          HTLC Expired
        </div>
        <p className="text-sm text-muted-foreground">
          The agent's Solana lock has expired. Your TNK was never locked, so no funds were lost.
          Please start a new swap.
        </p>
      </div>
    );
  }

  // ── Settled state ─────────────────────────────────────────────────────────────
  if (signState === "settled") {
    const claimTxId = htlcStatusQuery.data?.revealTxId;
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 mt-2">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
          <CheckCircle2 className="w-4 h-4" />
          Swap Complete
        </div>
        <p className="text-sm text-muted-foreground">
          {toToken} has been released to your Solana address.
        </p>
        <div className="flex flex-wrap gap-3 mt-2">
          {txHash && (
            <a
              href={`https://explorer.trac.network/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:underline inline-flex items-center gap-1"
            >
              View TNK lock <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {claimTxId && (
            <a
              href={`https://solscan.io/tx/${claimTxId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:underline inline-flex items-center gap-1"
            >
              View {toToken} release on Solscan <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Signed / waiting for settlement ──────────────────────────────────────────
  if (signState === "signed") {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 mt-2">
        <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
          <Loader2 className="w-4 h-4 animate-spin" />
          TNK Lock Submitted — Waiting for Settlement
        </div>
        <p className="text-sm text-muted-foreground">
          Your TNK lock is on-chain. The agent will release {outAmount?.toFixed(4)} {toToken} to your Solana address automatically.
          {txHash && (
            <a
              href={`https://explorer.trac.network/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              View tx <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </p>
        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Polling for settlement every 10s…
        </div>
      </div>
    );
  }

  // ── Signing (auto-sign in progress) ──────────────────────────────────────────
  if (signState === "signing") {
    return (
      <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 mt-2">
        <div className="flex items-center gap-2 text-orange-400 font-semibold">
          <Loader2 className="w-4 h-4 animate-spin" />
          Waiting for Tap Wallet signature…
        </div>
      </div>
    );
  }

  // ── Pending state — show QR / deep-link / copy options ───────────────────────
  const isExpiringSoon = remainingMs !== null && remainingMs > 0 && remainingMs < 30 * 60 * 1000;

  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-semibold text-orange-400 mb-0.5">
            <LockIcon className="w-4 h-4" />
            Sign TNK Lock in Tap Wallet
          </div>
          <p className="text-xs text-muted-foreground">
            Lock{tnkAmount ? ` ${tnkAmount.toFixed(2)} TNK` : " TNK"} on Trac Network to receive{" "}
            {outAmount ? `${outAmount.toFixed(4)} ` : ""}{toToken} on Solana.
          </p>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors text-xs">
            Cancel
          </button>
        )}
      </div>

      {/* Expiry countdown */}
      {remainingMs !== null && remainingMs > 0 && (
        <div className={`flex items-center gap-1.5 text-xs font-mono rounded-lg px-2.5 py-1.5 border ${
          isExpiringSoon
            ? "border-red-500/30 bg-red-500/10 text-red-400"
            : "border-white/10 bg-black/20 text-emerald-400"
        }`}>
          <Timer className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">Time to sign:</span>
          <span className={`ml-1 tabular-nums ${countdownColor(remainingMs)}`}>
            {formatCountdown(remainingMs)}
          </span>
          {isExpiringSoon && (
            <span className="ml-auto text-red-400 font-semibold animate-pulse">Sign now!</span>
          )}
        </div>
      )}

      {/* HTLC info */}
      <div className="rounded-lg bg-black/20 border border-white/5 p-2.5 text-xs space-y-1 font-mono">
        <div className="flex justify-between">
          <span className="text-muted-foreground">HTLC ID</span>
          <span className="text-orange-300 truncate max-w-[180px]">{htlcIdB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">RFQ</span>
          <span className="text-muted-foreground truncate max-w-[180px]">{rfqId.slice(0, 24)}…</span>
        </div>
      </div>

       {/* Primary sign button — triggers Tap Wallet popup directly */}
      <Button
        size="sm"
        className="w-full bg-orange-500 hover:bg-orange-600 text-white gap-1.5 font-semibold"
        onClick={handleDirectSign}
      >
        <LockIcon className="w-3.5 h-3.5" />
        Sign with Tap Wallet
      </Button>
      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        {/* Deep-link button */}
        <Button
          variant="outline"
          size="sm"
          className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 gap-1.5"
          onClick={handleDeepLink}
        >
          <Smartphone className="w-3.5 h-3.5" />
          Open Tap Wallet
        </Button>
        {/* QR toggle */}
        <Button
          variant="outline"
          size="sm"
          className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 gap-1.5"
          onClick={() => setShowQr(v => !v)}
        >
          <QrCode className="w-3.5 h-3.5" />
          {showQr ? "Hide QR" : "Show QR"}
        </Button>
      </div>

      {/* QR code */}
      {showQr && (
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="bg-white p-3 rounded-xl">
            <QRCode
              value={qrContent}
              size={180}
              style={{ height: "auto", maxWidth: "100%", width: "100%" }}
              viewBox="0 0 256 256"
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Scan with Tap Wallet to sign the TNK lock transaction
          </p>
        </div>
      )}

      {/* Copy payload */}
      <button
        onClick={handleCopy}
        className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 rounded-lg border border-white/5 hover:border-white/10 bg-black/10"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copied!" : "Copy payload (manual paste)"}
      </button>

      {/* Warning */}
      <div className="flex items-start gap-1.5 text-xs text-amber-400/80">
        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          {htlcExpiresAt
            ? `The agent's Solana lock expires in ${formatCountdown(remainingMs ?? 0)}. Sign before then or the swap will be cancelled automatically.`
            : "Do not close this window until the swap is complete. The agent's Solana lock will expire in ~24h."}
        </span>
      </div>
    </div>
  );
}
