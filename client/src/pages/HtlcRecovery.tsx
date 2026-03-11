/**
 * HTLC Recovery Page
 *
 * Shows all stuck/unclaimed HTLC locks and lets the sender trigger
 * a refund transaction after the timelock expires.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useWallet } from "@/contexts/WalletContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Connection, Transaction } from "@solana/web3.js";

// ─── Countdown timer hook ─────────────────────────────────────────────────────

function useCountdown(timelockUnix: number) {
  const [remaining, setRemaining] = useState(
    Math.max(0, timelockUnix - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const r = Math.max(0, timelockUnix - Math.floor(Date.now() / 1000));
      setRemaining(r);
    }, 1000);
    return () => clearInterval(interval);
  }, [timelockUnix]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return { remaining, minutes, seconds, expired: remaining === 0 };
}

// ─── Single HTLC row ─────────────────────────────────────────────────────────

type StuckHtlc = {
  rfqId: string;
  htlcId: string;
  pdaAddress: string;
  sender: string;
  recipient: string;
  amountSol: number;
  amountLamports: string;
  tokenMint: string | null;
  tokenSymbol: string;
  timelock: number;
  timelockExpired: boolean;
  claimed: boolean;
  refunded: boolean;
  dbStatus: string;
  fromToken: string | null | undefined;
  toToken: string | null | undefined;
};

function HtlcRow({
  htlc,
  walletAddress,
}: {
  htlc: StuckHtlc;
  walletAddress: string;
}) {
  const { remaining, minutes, seconds, expired } = useCountdown(htlc.timelock);
  const [isRefunding, setIsRefunding] = useState(false);
  const buildRefundTx = trpc.htlcRecovery.buildRefundTx.useMutation();
  const utils = trpc.useUtils();

  const isSender = htlc.sender === walletAddress;

  async function handleRefund() {
    if (!isSender) {
      toast.error("Only the original sender can refund this HTLC");
      return;
    }
    if (!expired) {
      toast.error(`Timelock not expired yet — ${minutes}m ${seconds}s remaining`);
      return;
    }

    setIsRefunding(true);
    try {
      const result = await buildRefundTx.mutateAsync({
        htlcId: htlc.htlcId,
        senderAddress: walletAddress,
        tokenMint: htlc.tokenMint ?? null,
      });

      // Ask Phantom to sign and submit
      const phantom = (window as any).phantom?.solana;
      if (!phantom) {
        toast.error("Phantom wallet not found. Please install Phantom.");
        return;
      }

      const txBytes = Buffer.from(result.serializedTx, "base64");
      const tx = Transaction.from(txBytes);

      const solRpcUrl =
        import.meta.env.VITE_SOL_RPC_URL ||
        "https://api.mainnet-beta.solana.com";
      const connection = new Connection(solRpcUrl, "confirmed");

      const { signature } = await phantom.signAndSendTransaction(tx);

      toast.success(`Refund submitted! Tx: ${signature.slice(0, 8)}...`, {
        action: {
          label: "Solscan",
          onClick: () =>
            window.open(`https://solscan.io/tx/${signature}`, "_blank"),
        },
      });

      // Refresh the list
      await utils.htlcRecovery.getStuckHtlcs.invalidate();
    } catch (err: any) {
      console.error("[HtlcRecovery] refund error:", err);
      toast.error(`Refund failed: ${err?.message ?? String(err)}`);
    } finally {
      setIsRefunding(false);
    }
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-yellow-400 border-yellow-400/40">
            {htlc.tokenSymbol}
          </Badge>
          <span className="font-mono text-sm font-semibold">
            {htlc.amountSol.toFixed(4)} {htlc.tokenSymbol}
          </span>
          <Badge
            variant="outline"
            className={
              expired
                ? "text-green-400 border-green-400/40"
                : "text-orange-400 border-orange-400/40"
            }
          >
            {expired ? "Refundable" : `${minutes}m ${seconds}s`}
          </Badge>
          {!isSender && (
            <Badge variant="outline" className="text-muted-foreground">
              Not your lock
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!expired || !isSender || isRefunding}
          onClick={handleRefund}
          className={
            expired && isSender
              ? "border-green-500/50 text-green-400 hover:bg-green-500/10"
              : "opacity-50"
          }
        >
          {isRefunding ? "Submitting..." : expired ? "Refund Now" : "Waiting for timelock"}
        </Button>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground font-mono">
        <div>
          <span className="text-foreground/50">HTLC ID: </span>
          {htlc.htlcId}
        </div>
        <div>
          <span className="text-foreground/50">PDA: </span>
          <a
            href={`https://solscan.io/account/${htlc.pdaAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline"
          >
            {htlc.pdaAddress.slice(0, 8)}...{htlc.pdaAddress.slice(-6)}
          </a>
        </div>
        <div>
          <span className="text-foreground/50">Sender: </span>
          {htlc.sender.slice(0, 8)}...{htlc.sender.slice(-6)}
          {isSender && (
            <span className="ml-1 text-cyan-400">(you)</span>
          )}
        </div>
        <div>
          <span className="text-foreground/50">Timelock: </span>
          {new Date(htlc.timelock * 1000).toLocaleString()}
        </div>
        <div>
          <span className="text-foreground/50">RFQ: </span>
          {htlc.rfqId}
        </div>
        <div>
          <span className="text-foreground/50">DB Status: </span>
          <Badge variant="outline" className="text-xs">
            {htlc.dbStatus}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HtlcRecovery() {
  const { user } = useAuth();
  const { publicKey } = useWallet();
  const { data: stuckHtlcs, isLoading, refetch } = trpc.htlcRecovery.getStuckHtlcs.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  // Use Phantom wallet address (from WalletContext) or fall back to Phantom window object
  const phantomAddr = (window as any).phantom?.solana?.publicKey?.toString();
  const walletAddress = publicKey?.toString() ?? phantomAddr ?? "";

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">HTLC Recovery</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Recover funds locked in HTLC escrow accounts after the timelock expires.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-yellow-200">
        <strong>How refunds work:</strong> If a swap didn't complete, your SOL or tokens remain
        locked in an on-chain HTLC escrow. Once the timelock expires (typically 10–40 minutes
        after the lock), you can click <strong>Refund Now</strong> to sign a transaction that
        returns the funds to your wallet. Only the original sender can trigger a refund.
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">
          Scanning on-chain HTLC accounts...
        </div>
      ) : !stuckHtlcs || stuckHtlcs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <div className="text-4xl mb-3">✓</div>
            <p className="font-medium">No stuck HTLCs found</p>
            <p className="text-sm mt-1">
              All HTLC locks have been claimed, refunded, or completed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {stuckHtlcs.length} Stuck HTLC{stuckHtlcs.length !== 1 ? "s" : ""} Found
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stuckHtlcs.map((htlc) => (
              <HtlcRow
                key={htlc.htlcId}
                htlc={htlc}
                walletAddress={walletAddress}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
