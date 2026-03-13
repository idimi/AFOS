/**
 * AFOS — Open Trades and Refunds tabs for SwapHistory
 *
 * Features:
 *   - Live block-height countdown (polls chain RPC every 30s)
 *   - On-chain claim refund button (Solana: buildSolanaHtlcRefundTx + Phantom sign/send)
 *   - HTLC detail drawer (slide-over with full HTLC details + explorer links)
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, CheckCircle2, AlertTriangle, RotateCcw, Loader2,
  Wallet, Search, ExternalLink, Copy, Info, X, XCircle, Clock, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { buildSolanaHtlcRefundTx, checkHtlcProgramDeployed } from "@/lib/solanaHtlc";
import { requestTnkHtlcRefund } from "@/lib/tnkHtlc";
import { useWallet as useSolanaWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { SupportedChain } from "@shared/const";
import { useMultiChainWallet } from "@/contexts/MultiChainWalletContext";

// ─── Shared Props ─────────────────────────────────────────────────────────────

interface TabProps {
  walletAddresses: string[];
  search?: string;
  adminOverride?: boolean;
}

// ─── Shared Search Bar ────────────────────────────────────────────────────────

export function HtlcSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
    >
      <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search peer, HTLC address, token…"
        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="text-muted-foreground/60 hover:text-foreground text-xs leading-none"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── HtlcSwap row type (mirrors drizzle schema) ───────────────────────────────

interface HtlcSwapRow {
  id: number;
  chain: SupportedChain;
  htlcAddress: string;
  secretHash: string;
  lockTxId: string | null;
  /** PDA seed string used to derive the on-chain HTLC PDA (e.g. htlc_a_rfq_1773...) */
  htlcId: string | null;
  amountRaw: string;
  amountHuman: string;
  locktime: number;
  status: "pending" | "completed" | "refunded" | "expired";
  peerId: string | null;
  rfqId: string | null;
  toToken: string | null;
  toChain: SupportedChain | null;
  refundTxId: string | null;
  senderAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  refundedAt: Date | null;
}

// ─── Explorer URL helpers ─────────────────────────────────────────────────────

function explorerTxUrl(chain: string, txHash: string): string {
  if (!txHash) return "#";
  if (chain === "solana")       return `https://solscan.io/tx/${txHash}`;
  if (chain === "ethereum")    return `https://etherscan.io/tx/${txHash}`;
  if (chain === "bitcoin")     return `https://mempool.space/tx/${txHash}`;
  if (chain === "trac_network") return `https://explorer.trac.network/tx/${txHash}`;
  return "#";
}

function explorerAddrUrl(chain: string, addr: string): string {
  if (!addr) return "#";
  if (chain === "solana")       return `https://solscan.io/account/${addr}`;
  if (chain === "ethereum")    return `https://etherscan.io/address/${addr}`;
  if (chain === "bitcoin")     return `https://mempool.space/address/${addr}`;
  if (chain === "trac_network") return `https://explorer.trac.network/address/${addr}`;
  return "#";
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() =>
    toast.success(`${label} copied`)
  );
}

// ─── Block-height countdown hook ─────────────────────────────────────────────

interface BlockCountdown {
  currentBlock: number | null;
  blocksRemaining: number | null;
  /** estimated seconds remaining (based on chain block time) */
  secondsRemaining: number | null;
  loading: boolean;
}

const BLOCK_TIMES: Record<string, number> = {
  solana: 0.4,         // ~0.4s per slot
  ethereum: 12,        // ~12s per block
  bitcoin: 600,        // ~10min per block
  trac_network: 600,   // ~10min per block (same as Bitcoin)
};

async function fetchCurrentBlock(chain: string): Promise<number | null> {
  try {
    if (chain === "solana") {
      const rpc = `${window.location.origin}/api/sol-rpc`;
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
      });
      const data = await res.json();
      return typeof data.result === "number" ? data.result : null;
    }
    if (chain === "ethereum") {
      const rpc = import.meta.env.VITE_ETH_RPC_URL || "https://eth.llamarpc.com";
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      const data = await res.json();
      return data.result ? parseInt(data.result, 16) : null;
    }
    if (chain === "bitcoin") {
      const res = await fetch("https://mempool.space/api/blocks/tip/height");
      const text = await res.text();
      return parseInt(text.trim(), 10) || null;
    }
    return null;
  } catch {
    return null;
  }
}

function useBlockCountdown(chain: string, locktime: number): BlockCountdown {
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const block = await fetchCurrentBlock(chain);
      if (!cancelled) {
        setCurrentBlock(block);
        setLoading(false);
      }
    };
    poll();
    const iv = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [chain]);

  const blocksRemaining = currentBlock !== null
    ? Math.max(0, locktime - currentBlock)
    : null;

  const blockTime = BLOCK_TIMES[chain] ?? 12;
  const secondsRemaining = blocksRemaining !== null
    ? Math.round(blocksRemaining * blockTime)
    : null;

  return { currentBlock, blocksRemaining, secondsRemaining, loading };
}

// ─── Unix-timestamp countdown hook ──────────────────────────────────────────

/**
 * Counts down to a Unix timestamp (seconds). Returns human-readable string
 * like "14m 32s" or "Expired" once the timestamp is in the past.
 */
function useTimeCountdown(expiryUnixSec: number): { label: string; expired: boolean } {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  const remaining = expiryUnixSec - now;
  if (remaining <= 0) return { label: "Expired", expired: true };

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const label = h > 0
    ? `${h}h ${m}m ${s}s`
    : m > 0
    ? `${m}m ${s}s`
    : `${s}s`;
  return { label, expired: false };
}

/**
 * Returns a human-readable "X ago" string for a past Unix timestamp (seconds).
 * Updates every 10 seconds. Returns empty string if timestamp is 0 or in the future.
 */
function useTimeSince(pastUnixSec: number): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!pastUnixSec) return;
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 10_000);
    return () => clearInterval(iv);
  }, [pastUnixSec]);

  if (!pastUnixSec || pastUnixSec > now) return "";
  const elapsed = now - pastUnixSec;
  if (elapsed < 60)  return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

// ─── HTLC Detail Drawer ───────────────────────────────────────────────────────

interface HtlcDetailDrawerProps {
  htlcId: number | null;
  onClose: () => void;
}

function HtlcDetailDrawer({ htlcId, onClose }: HtlcDetailDrawerProps) {
  const { data, isLoading } = trpc.history.htlcDetail.useQuery(
    { id: htlcId! },
    { enabled: htlcId !== null }
  );

  if (htlcId === null) return null;

  const chain = data?.chain ?? "solana";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Slide-over panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col"
        style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-foreground">HTLC Details</span>
            {data && (
              <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase"
                style={{
                  background: data.status === "pending" ? "rgba(245,158,11,0.12)" :
                    data.status === "completed" ? "rgba(16,185,129,0.12)" :
                    data.status === "refunded" ? "rgba(6,182,212,0.12)" : "rgba(100,116,139,0.12)",
                  border: `1px solid ${data.status === "pending" ? "rgba(245,158,11,0.3)" :
                    data.status === "completed" ? "rgba(16,185,129,0.3)" :
                    data.status === "refunded" ? "rgba(6,182,212,0.3)" : "rgba(100,116,139,0.3)"}`,
                  color: data.status === "pending" ? "#f59e0b" :
                    data.status === "completed" ? "#10b981" :
                    data.status === "refunded" ? "#06b6d4" : "#64748b",
                }}>
                {data.status}
              </span>
            )}
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
          )}

          {!isLoading && !data && (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">HTLC record not found</p>
            </div>
          )}

          {data && (
            <>
              {/* Amount & Chain */}
              <div className="rounded-xl p-4 space-y-3"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Amount</span>
                  <span className="text-sm font-bold font-mono text-foreground">
                    {data.amountHuman} {chain === "bitcoin" ? "BTC" : chain === "ethereum" ? "ETH" : chain === "trac_network" ? "TNK" : "SOL"}
                    {data.toToken && ` → ${data.toToken}`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Chain</span>
                  <span className="text-xs font-mono text-foreground capitalize">{chain}</span>
                </div>
                {data.peerId && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Peer ID</span>
                    <span className="text-xs font-mono text-foreground/80 truncate max-w-[200px]">{data.peerId}</span>
                  </div>
                )}
                {data.rfqId && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">RFQ ID</span>
                    <span className="text-xs font-mono text-foreground/80 truncate max-w-[200px]">{data.rfqId}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {data.locktime > 1_700_000_000 ? "Timelock Expiry" : "Locktime (block)"}
                  </span>
                  <span className="text-xs font-mono text-foreground/80">
                    {data.locktime > 1_700_000_000
                      ? new Date(data.locktime * 1000).toLocaleString()
                      : data.locktime.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Created</span>
                  <span className="text-xs font-mono text-foreground/80">
                    {new Date(data.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Addresses */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Addresses</p>
                {[
                  { label: "HTLC Address", value: data.htlcAddress, isAddr: true },
                  { label: "Sender", value: data.senderAddress, isAddr: true },
                  { label: "Secret Hash", value: data.secretHash, isAddr: false },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="rounded-lg p-3"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                    <div className="text-[9px] text-muted-foreground/60 mb-1">{row.label}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-foreground/80 truncate flex-1">{row.value}</span>
                      <button onClick={() => copyToClipboard(row.value!, row.label)}
                        className="p-1 rounded hover:bg-background transition-colors shrink-0">
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      </button>
                      {row.isAddr && (
                        <a href={explorerAddrUrl(chain, row.value!)} target="_blank" rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-background transition-colors shrink-0">
                          <ExternalLink className="w-3 h-3 text-cyan-400" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Transactions */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Transactions</p>
                {[
                  { label: "Lock Tx", value: data.lockTxId },
                  { label: "Refund Tx", value: data.refundTxId },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="rounded-lg p-3"
                    style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                    <div className="text-[9px] text-muted-foreground/60 mb-1">{row.label}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-foreground/80 truncate flex-1">{row.value}</span>
                      <button onClick={() => copyToClipboard(row.value!, row.label)}
                        className="p-1 rounded hover:bg-background transition-colors shrink-0">
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      </button>
                      <a href={explorerTxUrl(chain, row.value!)} target="_blank" rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-background transition-colors shrink-0">
                        <ExternalLink className="w-3 h-3 text-cyan-400" />
                      </a>
                    </div>
                  </div>
                ))}
                {!data.lockTxId && !data.refundTxId && (
                  <p className="text-xs text-muted-foreground/60 text-center py-2">No transactions recorded yet</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Open Trades ──────────────────────────────────────────────────────────────

interface OpenTrade {
  id: string;
  htlcId: number;
  direction: "buy_btc" | "sell_btc";
  fromSymbol: string;
  toSymbol: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  feeBps: number;
  peer: string;
  phase: "rfq_sent" | "quote_received" | "htlc_locked" | "awaiting_settle";
  receivedAt: Date;
  chain: string;
  locktime: number;
  htlcAddress: string;
  secretHash: string;
  senderAddress: string | null;
}

const PHASE_LABELS = {
  rfq_sent: "RFQ Sent",
  quote_received: "Quote Received",
  htlc_locked: "HTLC Locked",
  awaiting_settle: "Awaiting Settlement",
} as const;

const PHASE_COLORS = {
  rfq_sent: "#f59e0b",
  quote_received: "#8b5cf6",
  htlc_locked: "#10b981",
  awaiting_settle: "#06b6d4",
} as const;

function mapHtlcToOpenTrade(row: HtlcSwapRow): OpenTrade {
  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  const nativeToken = row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : row.chain === "trac_network" ? "TNK" : "SOL";
  // fromSymbol = the token actually locked (may be an SPL token like USDT, not the native token)
  const fromSymbol = (row.toToken && row.toToken.toUpperCase() !== nativeToken) ? row.toToken.toUpperCase() : nativeToken;
  const toSymbol = fromSymbol === nativeToken ? (row.toToken ?? "USDT") : nativeToken;
  const fromAmount = parseFloat(row.amountHuman);
  const isBuy = toSymbol === "BTC";

  let phase: OpenTrade["phase"] = "rfq_sent";
  if (row.lockTxId) phase = "htlc_locked";
  if (ageMs > 60_000) phase = "awaiting_settle";

  return {
    id: String(row.id),
    htlcId: row.id,
    direction: isBuy ? "buy_btc" : "sell_btc",
    fromSymbol,
    toSymbol,
    fromAmount,
    toAmount: 0,
    rate: 0,
    feeBps: 20,
    peer: row.peerId ?? "P2P Network",
    phase,
    receivedAt: new Date(row.createdAt),
    chain: row.chain,
    locktime: row.locktime,
    htlcAddress: row.htlcAddress,
    secretHash: row.secretHash,
    senderAddress: row.senderAddress,
  };
}

function OpenTradeCard({
  trade,
  onOpenDetail,
}: {
  trade: OpenTrade;
  onOpenDetail: (id: number) => void;
}) {
  const { blocksRemaining, secondsRemaining, loading: countdownLoading } =
    useBlockCountdown(trade.chain, trade.locktime);
  const { publicKey, signTransaction } = useSolanaWallet();
  const { connection } = useConnection();
  const { phantomMultiChain } = useMultiChainWallet();
  const updateHtlcRefund = trpc.history.updateHtlcRefund.useMutation();
  const utils = trpc.useUtils();
  const [earlyRefunding, setEarlyRefunding] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const executeEarlyRefund = useCallback(async () => {
    setShowConfirm(false);
    setEarlyRefunding(true);

    // ── Solana early refund ────────────────────────────────────────────────────
    if (trade.chain === "solana") {
      const phantomSolana = (
        (window as unknown as { phantom?: { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } } }).phantom?.solana ||
        (window as unknown as { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } }).solana
      );
      const phantomSolAddr = phantomMultiChain?.solanaAddress;
      const effectivePubkey = publicKey ?? (phantomSolAddr ? new PublicKey(phantomSolAddr) : null);

      if (!effectivePubkey || (!signTransaction && !phantomSolana?.signAndSendTransaction)) {
        toast.error("Wallet not connected", { description: "Connect your Phantom wallet to cancel this trade." });
        setEarlyRefunding(false);
        return;
      }
      try {
        const { transaction } = await buildSolanaHtlcRefundTx({
          senderPubkey: effectivePubkey,
          htlcId: trade.htlcAddress ?? `htlc_${(trade.secretHash ?? '').slice(0, 16)}`,
          connection,
        });
        let txHash: string;
        if (publicKey && signTransaction) {
          const signed = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(transaction);
          const rawTx = signed.serialize();
          txHash = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
        } else if (phantomSolana?.signAndSendTransaction) {
          const result = await phantomSolana.signAndSendTransaction(transaction);
          txHash = result.signature;
        } else {
          throw new Error("No signing method available — please reconnect your wallet");
        }
        await connection.confirmTransaction(txHash, "confirmed");
        await updateHtlcRefund.mutateAsync({ htlcAddress: trade.htlcAddress, refundTxId: txHash });
        await utils.history.openTrades.invalidate();
        toast.success("Trade cancelled & refunded!", {
          description: (
            <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 underline flex items-center gap-1">
              View on Solscan <ExternalLink className="w-3 h-3" />
            </a>
          ),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("Cancel & Refund failed", { description: msg });
      } finally {
        setEarlyRefunding(false);
      }
      return;
    }

    // ── TNK early refund ───────────────────────────────────────────────────────
    if (trade.chain === "trac_network") {
      try {
        const result = await requestTnkHtlcRefund({
          secretHash: trade.secretHash,
          amount: String(trade.fromAmount),
          escrowAddress: trade.htlcAddress,
        });
        await updateHtlcRefund.mutateAsync({
          htlcAddress: trade.htlcAddress,
          refundTxId: result.refundRequestSignature.slice(0, 64),
        });
        await utils.history.openTrades.invalidate();
        toast.success("TNK cancel request submitted!", {
          description: "Agent will process the on-chain refund to your Tap Wallet.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("TNK cancel failed", { description: msg });
      } finally {
        setEarlyRefunding(false);
      }
      return;
    }

    // ── Ethereum early refund ──────────────────────────────────────────────────
    if (trade.chain === "ethereum") {
      const rawEth = (window as unknown as {
        ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<string>; selectedAddress?: string; };
      }).ethereum;
      if (!rawEth || !rawEth.selectedAddress) {
        toast.error("MetaMask not connected", { description: "Connect your Ethereum wallet first." });
        setEarlyRefunding(false);
        return;
      }
      try {
        const secretHashHex = trade.secretHash.startsWith("0x")
          ? trade.secretHash.slice(2)
          : trade.secretHash;
        const calldata = "0x7249fbb6" + secretHashHex.padStart(64, "0");
        toast.loading("Waiting for MetaMask…", { id: "eth-early-refund" });
        const txHash = await rawEth.request({
          method: "eth_sendTransaction",
          params: [{ from: rawEth.selectedAddress, to: trade.htlcAddress, data: calldata, gas: "0x30D40" }],
        });
        toast.dismiss("eth-early-refund");
        await updateHtlcRefund.mutateAsync({ htlcAddress: trade.htlcAddress, refundTxId: txHash });
        await utils.history.openTrades.invalidate();
        toast.success("ETH trade cancelled!", {
          description: (
            <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 underline flex items-center gap-1">
              View on Etherscan <ExternalLink className="w-3 h-3" />
            </a>
          ),
        });
      } catch (err) {
        toast.dismiss("eth-early-refund");
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("ETH cancel failed", { description: msg });
      } finally {
        setEarlyRefunding(false);
      }
      return;
    }

    // ── Bitcoin early refund ───────────────────────────────────────────────────
    if (trade.chain === "bitcoin") {
      try {
        const btcLib = await import("@/lib/btcHtlc");
        const provider = btcLib.detectBtcProvider();
        if (provider === "unknown") {
          toast.error("No Bitcoin wallet detected", { description: "Connect Phantom, Tap Wallet, or Xverse." });
          setEarlyRefunding(false);
          return;
        }
        const refundAddress = await btcLib.getBtcAddress(provider);
        if (!refundAddress) {
          toast.error("Wallet not connected", { description: "Unlock your Bitcoin wallet and try again." });
          setEarlyRefunding(false);
          return;
        }
        const utxos = await btcLib.fetchUtxos(trade.htlcAddress);
        if (!utxos.length) {
          toast.error("No UTXO found", { description: "The HTLC address has no confirmed UTXOs yet." });
          setEarlyRefunding(false);
          return;
        }
        const htlcUtxo = utxos[0];
        const witnessScript = await btcLib.fetchWitnessUtxoScript(htlcUtxo.txid, htlcUtxo.vout);
        if (!witnessScript) {
          toast.error("Could not fetch UTXO script", { description: "Try again in a moment." });
          setEarlyRefunding(false);
          return;
        }
        const { psbtBase64 } = btcLib.buildBtcHtlcRefundPsbt({
          witnessScript,
          htlcAddress: trade.htlcAddress,
          lockTxid: htlcUtxo.txid,
          lockVout: htlcUtxo.vout,
          amountSats: htlcUtxo.value,
          locktime: trade.locktime,
          refundAddress,
        });
        toast.loading("Waiting for wallet signature…", { id: "btc-early-refund-sign" });
        const signedPsbt = await btcLib.signPsbtWithWallet(psbtBase64, provider, [0]);
        toast.dismiss("btc-early-refund-sign");
        toast.loading("Broadcasting refund tx…", { id: "btc-early-refund-broadcast" });
        const { txid, explorerUrl } = await btcLib.broadcastSignedPsbt(signedPsbt);
        toast.dismiss("btc-early-refund-broadcast");
        await updateHtlcRefund.mutateAsync({ htlcAddress: trade.htlcAddress, refundTxId: txid });
        await utils.history.openTrades.invalidate();
        toast.success("BTC trade cancelled!", {
          description: (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 underline flex items-center gap-1">
              View on Mempool.space <ExternalLink className="w-3 h-3" />
            </a>
          ),
        });
      } catch (err) {
        toast.dismiss("btc-early-refund-sign");
        toast.dismiss("btc-early-refund-broadcast");
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("BTC cancel failed", { description: msg });
      } finally {
        setEarlyRefunding(false);
      }
      return;
    }

    toast.info("Cancel not supported", { description: `Chain "${trade.chain}" does not have a browser-side cancel path yet.` });
    setEarlyRefunding(false);
  }, [trade, publicKey, signTransaction, connection, updateHtlcRefund, utils]);

  const isUrgent = blocksRemaining !== null && blocksRemaining < 10;
  const isExpired = blocksRemaining !== null && blocksRemaining === 0;
  const phase = trade.phase;
  const phaseColor = PHASE_COLORS[phase];

  // Progress bar: 0% = just locked, 100% = expired
  // We don't know the original locktime block, so we estimate from locktime
  // (locktime is the absolute block number when it expires)
  const progressPct = blocksRemaining !== null
    ? Math.max(0, Math.min(100, 100 - (blocksRemaining / Math.max(1, trade.locktime * 0.1)) * 100))
    : 50;

  const formatTimeRemaining = () => {
    if (countdownLoading) return "Loading…";
    if (blocksRemaining === null) return "Unknown";
    if (isExpired) return "Expired";
    if (secondsRemaining === null) return `${blocksRemaining} blocks`;
    const h = Math.floor(secondsRemaining / 3600);
    const m = Math.floor((secondsRemaining % 3600) / 60);
    const s = secondsRemaining % 60;
    if (h > 0) return `${blocksRemaining} blocks ≈ ${h}h ${m}m`;
    if (m > 0) return `${blocksRemaining} blocks ≈ ${m}m ${s}s`;
    return `${blocksRemaining} blocks ≈ ${s}s`;
  };

  return (
    <motion.div layout
      className="rounded-2xl p-4"
      style={{
        background: "var(--card)",
        border: `1px solid ${isUrgent ? "rgba(239,68,68,0.35)" : "var(--border)"}`,
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
              style={{ background: `${phaseColor}18`, border: `1px solid ${phaseColor}40`, color: phaseColor }}>
              {PHASE_LABELS[phase]}
            </span>
            <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
              style={{
                background: trade.direction === "buy_btc" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${trade.direction === "buy_btc" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}`,
                color: trade.direction === "buy_btc" ? "#10b981" : "#ef4444",
              }}>
              {trade.direction === "buy_btc" ? "BUY BTC" : "SELL BTC"}
            </span>
            {isUrgent && !isExpired && (
              <div className="flex items-center gap-1 ml-auto">
                <AlertTriangle className="w-3 h-3 text-red-400" />
                <span className="text-[9px] font-mono text-red-400">Expires soon</span>
              </div>
            )}
            {isExpired && (
              <div className="flex items-center gap-1 ml-auto">
                <AlertTriangle className="w-3 h-3 text-red-500" />
                <span className="text-[9px] font-mono text-red-500">Expired</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mb-3">
            {[
              { label: "You send", value: `${trade.fromAmount.toLocaleString()} ${trade.fromSymbol}` },
              { label: "You receive", value: trade.toAmount > 0 ? `${trade.toAmount} ${trade.toSymbol}` : "Pending" },
              { label: "Rate", value: trade.rate > 0 ? `1 BTC = $${trade.rate.toLocaleString()}` : "Awaiting" },
              { label: "Fee", value: `${trade.feeBps} bps` },
              { label: "Peer", value: trade.peer },
              { label: "Chain", value: trade.chain },
              { label: "Received", value: `${Math.round((Date.now() - trade.receivedAt.getTime()) / 1000)}s ago` },
              { label: "Locktime block", value: trade.locktime.toLocaleString() },
            ].map(item => (
              <div key={item.label}>
                <div className="text-[9px] text-muted-foreground/60">{item.label}</div>
                <div className="text-[10px] font-mono text-foreground/80">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Live block countdown + progress bar */}
          <div>
            <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
              <span>HTLC timeout</span>
              <span className={isUrgent ? "text-red-400" : isExpired ? "text-red-500" : "text-muted-foreground"}>
                {formatTimeRemaining()}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${progressPct}%`,
                  background: isExpired ? "#ef4444" : isUrgent ? "#f97316" : "#10b981",
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          {phase === "quote_received" && (
            <>
              <button
                onClick={() => toast.success("Quote accepted — HTLC locking...", { description: "Atomic escrow initiated" })}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.35)", color: "#10b981" }}>
                Accept
              </button>
              <button
                onClick={() => toast.info("Trade rejected", { description: "RFQ cancelled, no funds moved" })}
                className="px-3 py-1.5 rounded-lg text-[10px] font-mono text-muted-foreground transition-all"
                style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                Reject
              </button>
            </>
          )}
          {phase === "htlc_locked" && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono text-emerald-400">Locked</span>
            </div>
          )}
          {/* Cancel & Refund button — available when peer has gone offline or trade is stuck */}
          {(phase === "htlc_locked" || phase === "awaiting_settle" || phase === "rfq_sent") && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={earlyRefunding}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-mono transition-all disabled:opacity-50"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}
              title="Cancel trade and recover your funds"
            >
              {earlyRefunding
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <XCircle className="w-3 h-3" />
              }
              <span>{earlyRefunding ? "Cancelling…" : "Cancel"}</span>
            </button>
          )}
          {/* Detail drawer button */}
          <button
            onClick={() => onOpenDetail(trade.htlcId)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-mono transition-all"
            style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
            title="View HTLC details"
          >
            <Info className="w-3 h-3" />
            <span>Details</span>
          </button>
        </div>
      </div>

      {/* Cancel & Refund confirmation dialog */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setShowConfirm(false)}
          >
            <div
              className="rounded-2xl p-5 max-w-sm w-full"
              style={{ background: "var(--card)", border: "1px solid rgba(239,68,68,0.35)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <h3 className="text-sm font-bold text-foreground">Cancel Trade & Refund</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                This will attempt an early exit from the HTLC escrow and return your funds.
              </p>
              <p className="text-[10px] font-mono text-amber-400/80 mb-4">
                ⚠ Only cancel if the counterparty is offline or unresponsive. Cancelling an active swap may result in loss of funds if the peer has already locked their side.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-4 text-[10px] font-mono">
                <div>
                  <div className="text-muted-foreground/60">You send</div>
                  <div className="text-foreground/80">{trade.fromAmount.toLocaleString()} {trade.fromSymbol}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60">Chain</div>
                  <div className="text-foreground/80">{trade.chain}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60">Peer</div>
                  <div className="text-foreground/80 truncate">{trade.peer}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60">Phase</div>
                  <div className="text-foreground/80">{PHASE_LABELS[phase]}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2 rounded-lg text-[11px] font-mono transition-all"
                  style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                >
                  Keep Trade
                </button>
                <button
                  onClick={executeEarlyRefund}
                  className="flex-1 py-2 rounded-lg text-[11px] font-bold transition-all"
                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444" }}
                >
                  Cancel & Refund
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function OpenTradesTab({ walletAddresses, search = "" }: TabProps) {
  const { data, isLoading } = trpc.history.openTrades.useQuery(
    { walletAddresses, search },
    { refetchInterval: 15000 }
  );
  const [selectedHtlcId, setSelectedHtlcId] = useState<number | null>(null);

  const trades: OpenTrade[] = (data?.trades ?? []).map(mapHtlcToOpenTrade);
  const hasWallet = walletAddresses.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {!hasWallet && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)" }}
          >
            <Wallet className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
            <span className="text-cyan-300/80">
              Connect a wallet to see your open trades. Showing all network trades (operator view).
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {trades.length} active trade{trades.length !== 1 ? "s" : ""} in progress
          </p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-400">Live</span>
          </div>
        </div>

        {trades.length === 0 && (
          <div className="py-16 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No open trades</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {hasWallet ? "Your active swaps will appear here" : "Active swaps will appear here for approval"}
            </p>
          </div>
        )}

        {trades.map(trade => (
          <OpenTradeCard key={trade.id} trade={trade} onOpenDetail={setSelectedHtlcId} />
        ))}
      </div>

      <HtlcDetailDrawer htlcId={selectedHtlcId} onClose={() => setSelectedHtlcId(null)} />
    </>
  );
}

// ─── Refunds Tab ──────────────────────────────────────────────────────────────

interface RefundRecord {
  id: string;
  htlcId: number;
  fromSymbol: string;
  toSymbol: string;
  amount: number;
  usdValue: number;
  peer: string;
  failReason: string;
  htlcExpiry: Date;
  status: "pending" | "claimable" | "claimed" | "refunded" | "expired";
  txHash: string;
  escrowPda: string;
  chain: string;
  htlcAddress: string;
  secretHash: string;
  senderAddress: string | null;
  amountHuman: string;
  locktime: number;
  lockTxId: string | null;
  /** PDA seed string (e.g. htlc_a_rfq_1773...) — used to derive the on-chain PDA for refund */
  htlcSeedId: string | null;
}

const PRICE_ESTIMATES: Record<string, number> = {
  BTC: 95000, ETH: 3000, SOL: 150, USDT: 1, USDC: 1, TNK: 0.01,
};

function mapHtlcToRefund(row: HtlcSwapRow): RefundRecord {
  // The native token for this chain
  const nativeToken = row.chain === "bitcoin" ? "BTC" : row.chain === "ethereum" ? "ETH" : row.chain === "trac_network" ? "TNK" : "SOL";
  // toToken stores the actual locked token (e.g. USDT when Agent B locked USDT on Solana).
  // If toToken differs from the native token, the locked asset is an SPL/ERC-20 token.
  // fromSymbol = what was actually locked (the token the user needs to refund).
  const fromSymbol = (row.toToken && row.toToken.toUpperCase() !== nativeToken) ? row.toToken.toUpperCase() : nativeToken;
  // toSymbol = what the user would have received (the counterpart token)
  const toSymbol = fromSymbol === nativeToken ? (row.toToken ?? "USDT") : nativeToken;
  const amount = parseFloat(row.amountHuman);
  const price = PRICE_ESTIMATES[fromSymbol] ?? 1;
  const usdValue = amount * price;
  // Map DB status to UI status:
  //   pending   → pending (timelock not yet expired) OR claimable (timelock expired)
  //   completed → claimed   (user already claimed it on-chain)
  //   refunded  → refunded  (server refunded it on-chain)
  //   expired   → expired   (timelock expired, no action taken)
  const nowSec = Math.floor(Date.now() / 1000);
  // locktime > 1_000_000_000 means it's a Unix timestamp (Solana/ETH); otherwise block height
  const isUnixTimelock = row.locktime > 1_000_000_000;
  const timelockExpired = isUnixTimelock && row.locktime < nowSec;
  const status: RefundRecord["status"] =
    row.status === "completed" ? "claimed" :
    row.status === "refunded"  ? "refunded" :
    row.status === "expired"   ? "expired" :
    timelockExpired            ? "claimable" :
    isUnixTimelock             ? "pending" :
    "claimable"; // block-height timelocks: always show as claimable (block check done elsewhere)

  // htlcExpiry: use locktime Unix timestamp for Solana/ETH; fall back to updatedAt for block-height chains
  const htlcExpiry = isUnixTimelock
    ? new Date(row.locktime * 1000)
    : (row.refundedAt ? new Date(row.refundedAt) : new Date(row.updatedAt));

  return {
    id: String(row.id),
    htlcId: row.id,
    fromSymbol,
    toSymbol,
    amount,
    usdValue,
    peer: row.peerId ?? "P2P Network",
    failReason: row.status === "expired" ? "HTLC expired — no settlement received" : "Swap refunded by peer",
    htlcExpiry,
    status,
    txHash: row.refundTxId ?? row.lockTxId ?? row.secretHash.slice(0, 16) + "...",
    escrowPda: row.htlcAddress.length > 20 ? row.htlcAddress.slice(0, 12) + "..." : row.htlcAddress,
    chain: row.chain,
    htlcAddress: row.htlcAddress,
    secretHash: row.secretHash,
    senderAddress: row.senderAddress,
    amountHuman: row.amountHuman,
    locktime: row.locktime,
    lockTxId: row.lockTxId,
    htlcSeedId: row.htlcId,
  };
}

function RefundCard({
  refund,
  onOpenDetail,
}: {
  refund: RefundRecord;
  onOpenDetail: (id: number) => void;
}) {
  const { publicKey, signTransaction, sendTransaction } = useSolanaWallet();
  const { connection } = useConnection();
  const { phantomMultiChain } = useMultiChainWallet();
  const updateHtlcRefund = trpc.history.updateHtlcRefund.useMutation();
  const agentRefundHtlc = trpc.history.agentRefundHtlc.useMutation();
  const utils = trpc.useUtils();
  const [claiming, setClaiming] = useState(false);
  // Live countdown for pending/locked HTLCs
  const isUnixTimelock = refund.locktime > 1_000_000_000;
  const { label: countdownLabel, expired: countdownExpired } = useTimeCountdown(
    isUnixTimelock ? refund.locktime : 0
  );
  // "Expired X ago" for claimable HTLCs
  const expiredAgoLabel = useTimeSince(isUnixTimelock ? refund.locktime : 0);

  const claimRefund = useCallback(async () => {
    // Solana claim — the user's wallet is the on-chain sender (they locked the HTLC).
    // The user signs the refund tx directly with their Phantom wallet.
    if (refund.chain === "solana") {
      const phantomSolana = (
        (window as unknown as { phantom?: { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } } }).phantom?.solana ||
        (window as unknown as { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } }).solana
      );
      const phantomSolAddr = phantomMultiChain?.solanaAddress;
      const effectivePubkey = publicKey ?? (phantomSolAddr ? new PublicKey(phantomSolAddr) : null);

      if (!effectivePubkey || (!signTransaction && !phantomSolana?.signAndSendTransaction)) {
        toast.error("Wallet not connected", { description: "Connect your Phantom wallet to claim the refund." });
        return;
      }

      setClaiming(true);
      const toastId = "sol-refund-" + refund.htlcAddress.slice(0, 8);
      // Use htlcSeedId (the PDA seed string like "htlc_a_rfq_1773...") to derive the correct PDA.
      // lockTxId is the Solana tx signature — NOT the PDA seed. Using it would derive the wrong account.
      const htlcId = refund.htlcSeedId ?? refund.htlcAddress;
      toast.loading("Waiting for Phantom signature…", { id: toastId });
      try {
        const { transaction } = await buildSolanaHtlcRefundTx({
          senderPubkey: effectivePubkey,
          htlcId,
          connection,
          tokenSymbol: refund.fromSymbol !== "SOL" ? refund.fromSymbol : undefined,
        });
        let txHash: string;
        if (publicKey && signTransaction) {
          const signed = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(transaction);
          const rawTx = signed.serialize();
          txHash = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
        } else if (phantomSolana?.signAndSendTransaction) {
          const result = await phantomSolana.signAndSendTransaction(transaction);
          txHash = result.signature;
        } else {
          throw new Error("No signing method available — please reconnect your wallet");
        }
        await connection.confirmTransaction(txHash, "confirmed");
        await updateHtlcRefund.mutateAsync({ htlcAddress: refund.htlcAddress, refundTxId: txHash });
        await utils.history.refunds.invalidate();
        await utils.history.myOnChainRefunds.invalidate();
        toast.success("Refund successful! SOL returned to your wallet.", {
          id: toastId,
          duration: 8000,
          description: (
            <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 underline flex items-center gap-1 mt-1">
              View on Solscan <ExternalLink className="w-3 h-3" />
            </a>
          ),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("Refund failed", { id: toastId, description: msg });
      } finally {
        setClaiming(false);
      }
      return;
    }

    // TNK claim (Trac Network) — sends a signed refund request to the agent
    if (refund.chain === "trac_network") {
      setClaiming(true);
      try {
        const result = await requestTnkHtlcRefund({
          secretHash: refund.secretHash,
          amount: refund.amountHuman,
          escrowAddress: refund.htlcAddress,
        });
        // Record the refund request signature as the refundTxId (on-chain tx is executed by agent)
        await updateHtlcRefund.mutateAsync({
          htlcAddress: refund.htlcAddress,
          refundTxId: result.refundRequestSignature.slice(0, 64),
        });
        await utils.history.refunds.invalidate();
        toast.success("TNK refund request submitted!", {
          description: `Signed at ${new Date(result.requestedAt).toLocaleTimeString()} — agent will process the on-chain refund`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("TNK refund request failed", { description: msg });
      } finally {
        setClaiming(false);
      }
      return;
    }

    // Ethereum — call refund(bytes32 secretHash) on the HTLC contract via MetaMask
    if (refund.chain === "ethereum") {
      const rawEth = (window as unknown as {
        ethereum?: {
          request: (args: { method: string; params?: unknown[] }) => Promise<string>;
          selectedAddress?: string;
        };
      }).ethereum;
      if (!rawEth) {
        toast.error("No Ethereum provider", { description: "Install MetaMask or Phantom to claim ETH refunds." });
        return;
      }
      const fromAddress = rawEth.selectedAddress;
      if (!fromAddress) {
        toast.error("MetaMask not connected", { description: "Connect your Ethereum wallet first." });
        return;
      }
      setClaiming(true);
      try {
        // ABI-encode refund(bytes32 secretHash)
        // Function selector: keccak256("refund(bytes32)") = 0x7249fbb6
        const secretHashHex = refund.secretHash.startsWith("0x")
          ? refund.secretHash.slice(2)
          : refund.secretHash;
        const calldata = "0x7249fbb6" + secretHashHex.padStart(64, "0");
        toast.loading("Waiting for MetaMask signature…", { id: "eth-refund-sign" });
        const txHash = await rawEth.request({
          method: "eth_sendTransaction",
          params: [{
            from: fromAddress,
            to:   refund.htlcAddress,
            data: calldata,
            gas:  "0x30D40", // 200 000 gas
          }],
        });
        toast.dismiss("eth-refund-sign");
        await updateHtlcRefund.mutateAsync({ htlcAddress: refund.htlcAddress, refundTxId: txHash });
        await utils.history.refunds.invalidate();
        toast.success("ETH refund submitted!", {
          description: (
            <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 underline flex items-center gap-1">
              View on Etherscan <ExternalLink className="w-3 h-3" />
            </a>
          ),
        });
      } catch (err) {
        toast.dismiss("eth-refund-sign");
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("ETH refund failed", { description: msg });
      } finally {
        setClaiming(false);
      }
      return;
    }

    // Bitcoin — build CLTV-timeout refund PSBT and sign via Phantom / Tap / Xverse
    if (refund.chain === "bitcoin") {
      setClaiming(true);
      try {
        const btcLib = await import("@/lib/btcHtlc");
        const provider = btcLib.detectBtcProvider();
        if (provider === "unknown") {
          toast.error("No Bitcoin wallet detected", { description: "Connect Phantom, Tap Wallet, or Xverse to claim BTC refunds." });
          setClaiming(false);
          return;
        }
        const refundAddress = await btcLib.getBtcAddress(provider);
        if (!refundAddress) {
          toast.error("Wallet not connected", { description: "Unlock your Bitcoin wallet and try again." });
          setClaiming(false);
          return;
        }
        // Fetch the HTLC UTXOs from mempool.space
        const utxos = await btcLib.fetchUtxos(refund.htlcAddress);
        if (!utxos.length) {
          toast.error("No claimable UTXO found", { description: `The HTLC address ${refund.htlcAddress.slice(0, 20)}… has no confirmed UTXOs.` });
          setClaiming(false);
          return;
        }
        const htlcUtxo = utxos[0];
        // Fetch the P2WSH witnessUtxo script for the input
        const witnessUtxoScript = await btcLib.fetchWitnessUtxoScript(htlcUtxo.txid, htlcUtxo.vout);
        if (!witnessUtxoScript) {
          toast.error("Could not fetch UTXO script", { description: "Try again in a moment." });
          setClaiming(false);
          return;
        }
        // Build the CLTV-timeout refund PSBT
        const { psbtBase64 } = btcLib.buildBtcHtlcRefundPsbt({
          witnessScript: witnessUtxoScript,
          htlcAddress: refund.htlcAddress,
          lockTxid: htlcUtxo.txid,
          lockVout: htlcUtxo.vout,
          amountSats: htlcUtxo.value,
          locktime: refund.locktime,
          refundAddress,
        });
        toast.loading("Waiting for wallet signature…", { id: "btc-refund-sign" });
        const signedPsbt = await btcLib.signPsbtWithWallet(psbtBase64, provider, [0]);
        toast.dismiss("btc-refund-sign");
        toast.loading("Broadcasting refund tx…", { id: "btc-refund-broadcast" });
        const { txid, explorerUrl } = await btcLib.broadcastSignedPsbt(signedPsbt);
        toast.dismiss("btc-refund-broadcast");
        await updateHtlcRefund.mutateAsync({ htlcAddress: refund.htlcAddress, refundTxId: txid });
        await utils.history.refunds.invalidate();
        toast.success("BTC refund broadcast!", {
          description: (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-cyan-400 underline flex items-center gap-1">
              View on Mempool.space <ExternalLink className="w-3 h-3" />
            </a>
          ),
        });
      } catch (err) {
        toast.dismiss("btc-refund-sign");
        toast.dismiss("btc-refund-broadcast");
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error("BTC refund failed", { description: msg });
      } finally {
        setClaiming(false);
      }
      return;
    }
    // Fallback for unknown chains
    toast.info("Refund not supported", {
      description: `Chain "${refund.chain}" does not have a browser-side refund path yet.`,
    });
  }, [refund, publicKey, signTransaction, sendTransaction, connection, updateHtlcRefund, utils]);

  return (
    <motion.div layout
      className="rounded-2xl p-4"
      style={{
        background: "var(--card)",
        border: `1px solid ${refund.status === "claimable" ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono"
              style={{
                background: refund.status === "claimable" ? "rgba(245,158,11,0.12)" :
                            refund.status === "claimed"   ? "rgba(16,185,129,0.12)" :
                            refund.status === "refunded"  ? "rgba(6,182,212,0.12)" :
                            refund.status === "pending"   ? "rgba(59,130,246,0.12)" :
                            "rgba(100,116,139,0.12)",
                border: `1px solid ${
                  refund.status === "claimable" ? "rgba(245,158,11,0.3)" :
                  refund.status === "claimed"   ? "rgba(16,185,129,0.3)" :
                  refund.status === "refunded"  ? "rgba(6,182,212,0.3)" :
                  refund.status === "pending"   ? "rgba(59,130,246,0.3)" :
                  "rgba(100,116,139,0.3)"}`,
                color: refund.status === "claimable" ? "#f59e0b" :
                       refund.status === "claimed"   ? "#10b981" :
                       refund.status === "refunded"  ? "#06b6d4" :
                       refund.status === "pending"   ? "#3b82f6" :
                       "#64748b",
              }}>
              {refund.status === "claimable" ? "CLAIMABLE" :
               refund.status === "claimed"   ? "CLAIMED" :
               refund.status === "refunded"  ? "REFUNDED" :
               refund.status === "pending"   ? "LOCKED" :
               "EXPIRED"}
            </span>
            {/* Live countdown for pending/locked HTLCs */}
            {refund.status === "pending" && isUnixTimelock && !countdownExpired && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#93c5fd" }}>
                <Clock className="w-2.5 h-2.5" />
                {countdownLabel}
              </span>
            )}
            {/* "Expired X ago" for claimable HTLCs */}
            {refund.status === "claimable" && expiredAgoLabel && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
                <Clock className="w-2.5 h-2.5" />
                Expired {expiredAgoLabel}
              </span>
            )}
            <span className="text-[10px] font-mono text-muted-foreground">
              {refund.amount} {refund.fromSymbol} → {refund.toSymbol}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mb-2">
            {[
              { label: "Value", value: `$${refund.usdValue.toFixed(2)}` },
              { label: "Peer", value: refund.peer },
              { label: "Chain", value: refund.chain },
              { label: "Reason", value: refund.failReason },
              { label: "Tx", value: refund.txHash },
              { label: "Escrow", value: refund.escrowPda },
              {
                label: refund.status === "pending" && isUnixTimelock && !countdownExpired
                  ? "Refundable In"
                  : "HTLC Expiry",
                value: refund.status === "pending" && isUnixTimelock && !countdownExpired
                  ? countdownLabel
                  : refund.htlcExpiry.toLocaleString(),
              },
            ].map(item => (
              <div key={item.label}>
                <div className="text-[9px] text-muted-foreground/60">{item.label}</div>
                <div className="text-[10px] font-mono text-foreground/80 truncate">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Explorer links */}
          {refund.txHash && !refund.txHash.endsWith("...") && (
            <a href={explorerTxUrl(refund.chain, refund.txHash)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[9px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
              <ExternalLink className="w-2.5 h-2.5" />
              View on explorer
            </a>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          {refund.status === "claimable" && (
            <button
              onClick={claimRefund}
              disabled={claiming}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold transition-all disabled:opacity-60"
              style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "#f59e0b" }}>
              {claiming ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              {claiming ? "Claiming…" : "Claim"}
            </button>
          )}
          {refund.status === "claimed" && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg shrink-0"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-mono text-emerald-400">Claimed</span>
            </div>
          )}
          {refund.status === "refunded" && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg shrink-0"
              style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)" }}>
              <CheckCircle2 className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-mono text-cyan-400">Refunded</span>
            </div>
          )}
          {/* Detail drawer button */}
          <button
            onClick={() => onOpenDetail(refund.htlcId)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-mono transition-all"
            style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
            title="View HTLC details"
          >
            <Info className="w-3 h-3" />
            <span>Details</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Claim All Batch Button ──────────────────────────────────────────────────

function ClaimAllButton({ claimable }: { claimable: RefundRecord[] }) {
  const { publicKey, signTransaction } = useSolanaWallet();
  const { connection } = useConnection();
  const { phantomMultiChain } = useMultiChainWallet();
  const updateHtlcRefund = trpc.history.updateHtlcRefund.useMutation();
  const utils = trpc.useUtils();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const claimAll = useCallback(async () => {
    if (running || claimable.length < 1) return;

    // Resolve Phantom wallet once
    const phantomSolana = (
      (window as unknown as { phantom?: { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } } }).phantom?.solana ||
      (window as unknown as { solana?: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } }).solana
    );
    const phantomSolAddr = phantomMultiChain?.solanaAddress;
    const effectivePubkey = publicKey ?? (phantomSolAddr ? new PublicKey(phantomSolAddr) : null);

    setRunning(true);
    setProgress({ done: 0, total: claimable.length });

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < claimable.length; i++) {
      const refund = claimable[i];
      setProgress({ done: i, total: claimable.length });

      try {
        if (refund.chain === "solana") {
          if (!effectivePubkey || (!signTransaction && !phantomSolana?.signAndSendTransaction)) {
            toast.error("Wallet not connected", { description: "Connect Phantom to claim SOL refunds." });
            failed++;
            continue;
          }
          // Use htlcSeedId (PDA seed string) — lockTxId is the tx signature, NOT the PDA seed
          const htlcId = refund.htlcSeedId ?? refund.htlcAddress;
          const toastId = `claim-all-sol-${i}`;
          toast.loading(`Claiming ${i + 1}/${claimable.length} — waiting for Phantom…`, { id: toastId });
          const { transaction } = await buildSolanaHtlcRefundTx({
            senderPubkey: effectivePubkey,
            htlcId,
            connection,
            tokenSymbol: refund.fromSymbol !== "SOL" ? refund.fromSymbol : undefined,
          });
          let txHash: string;
          if (publicKey && signTransaction) {
            const signed = await (signTransaction as (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>)(transaction);
            txHash = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
          } else if (phantomSolana?.signAndSendTransaction) {
            const result = await phantomSolana.signAndSendTransaction(transaction);
            txHash = result.signature;
          } else {
            throw new Error("No signing method available");
          }
          await connection.confirmTransaction(txHash, "confirmed");
          await updateHtlcRefund.mutateAsync({ htlcAddress: refund.htlcAddress, refundTxId: txHash });
          toast.dismiss(toastId);
          succeeded++;
        } else if (refund.chain === "trac_network") {
          const { requestTnkHtlcRefund: tnkRefund } = await import("@/lib/tnkHtlc");
          const result = await tnkRefund({
            secretHash: refund.secretHash,
            amount: refund.amountHuman,
            escrowAddress: refund.htlcAddress,
          });
          await updateHtlcRefund.mutateAsync({
            htlcAddress: refund.htlcAddress,
            refundTxId: result.refundRequestSignature.slice(0, 64),
          });
          succeeded++;
        } else if (refund.chain === "ethereum") {
          const rawEth = (window as unknown as {
            ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string>; selectedAddress?: string };
          }).ethereum;
          if (!rawEth?.selectedAddress) { failed++; continue; }
          const secretHashHex = refund.secretHash.startsWith("0x") ? refund.secretHash.slice(2) : refund.secretHash;
          const calldata = "0x7249fbb6" + secretHashHex.padStart(64, "0");
          const txHash = await rawEth.request({
            method: "eth_sendTransaction",
            params: [{ from: rawEth.selectedAddress, to: refund.htlcAddress, data: calldata, gas: "0x30D40" }],
          });
          await updateHtlcRefund.mutateAsync({ htlcAddress: refund.htlcAddress, refundTxId: txHash });
          succeeded++;
        } else {
          // Bitcoin and unknown chains — skip (require manual signing)
          failed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Claim ${i + 1}/${claimable.length} failed`, { description: msg });
        failed++;
      }
    }

    setProgress({ done: claimable.length, total: claimable.length });
    await utils.history.refunds.invalidate();
    await utils.history.myOnChainRefunds.invalidate();

    if (succeeded > 0 && failed === 0) {
      toast.success(`All ${succeeded} refund${succeeded > 1 ? "s" : ""} claimed successfully!`);
    } else if (succeeded > 0) {
      toast.success(`${succeeded} claimed, ${failed} failed — check individual cards for details.`);
    } else {
      toast.error("All claims failed — check wallet connection and try individually.");
    }

    setRunning(false);
    setProgress(null);
  }, [claimable, running, publicKey, signTransaction, connection, phantomMultiChain, updateHtlcRefund, utils]);

  if (claimable.length < 2) return null;

  return (
    <button
      onClick={claimAll}
      disabled={running}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all disabled:opacity-60"
      style={{
        background: running ? "rgba(245,158,11,0.08)" : "rgba(245,158,11,0.15)",
        border: "1px solid rgba(245,158,11,0.35)",
        color: "#f59e0b",
      }}
      title={`Claim all ${claimable.length} refundable HTLCs sequentially`}
    >
      {running ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          {progress ? `Claiming ${progress.done + 1}/${progress.total}…` : "Claiming…"}
        </>
      ) : (
        <>
          <Zap className="w-3 h-3" />
          Claim All ({claimable.length})
        </>
      )}
    </button>
  );
}

export function RefundsTab({ walletAddresses, search = "", adminOverride = false }: TabProps) {
  const { data, isLoading } = trpc.history.refunds.useQuery(
    { walletAddresses, search, adminOverride },
    { refetchInterval: 30000 }
  );
  // On-chain scanner — always runs, finds HTLCs not in DB too
  const { data: onChainData, isLoading: onChainLoading } = trpc.history.myOnChainRefunds.useQuery(
    { walletAddresses, adminOverride },
    { refetchInterval: 60000 }
  );
  const [selectedHtlcId, setSelectedHtlcId] = useState<number | null>(null);

  // Merge DB refunds with on-chain scanner results (deduplicate by htlcId)
  const dbRefunds: RefundRecord[] = (data?.refunds ?? []).map(mapHtlcToRefund);
  const dbHtlcIds = new Set(dbRefunds.map(r => r.htlcAddress));

  // Map on-chain HTLCs to RefundRecord format (only expired ones not already in DB)
  const onChainRefunds: RefundRecord[] = (onChainData?.htlcs ?? [])
    .filter(h => h.timelockExpired && !dbHtlcIds.has(h.pdaAddress))
    .map(h => ({
      id: h.pdaAddress,
      htlcId: 0,
      fromSymbol: h.token,
      toSymbol: "USDT",
      amount: parseFloat(h.amountHuman),
      usdValue: parseFloat(h.amountHuman) * (PRICE_ESTIMATES[h.token] ?? 1),
      peer: "P2P Network",
      failReason: "HTLC expired — timelock passed without settlement",
      htlcExpiry: new Date((h.timelockExpiry ?? 0) * 1000),
      status: "claimable" as const,
      txHash: h.htlcId,
      escrowPda: h.pdaAddress.slice(0, 12) + "...",
      chain: h.chain,
      htlcAddress: h.chain === "solana" ? h.htlcId : h.pdaAddress,
      secretHash: h.secretHash ?? "",
      senderAddress: h.senderAddress,
      amountHuman: h.amountHuman,
      locktime: h.timelockExpiry ?? 0,
      lockTxId: h.htlcId,
      htlcSeedId: h.htlcId, // on-chain htlcId IS the PDA seed
    }));

  const refunds = [...dbRefunds, ...onChainRefunds];
  const hasWallet = walletAddresses.length > 0;
  const claimable = refunds.filter(r => r.status === "claimable");
  const claimed = refunds.filter(r => r.status === "claimed");
  const refunded = refunds.filter(r => r.status === "refunded");
  const isScanning = isLoading || onChainLoading;

  if (isScanning && refunds.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 gap-2">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        <span className="text-xs text-muted-foreground">Scanning SOL · ETH · BTC chains...</span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {onChainLoading && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)" }}
          >
            <Loader2 className="w-3 h-3 text-cyan-400 animate-spin flex-shrink-0" />
            <span className="text-cyan-300/80">Scanning SOL · ETH · BTC chains for unclaimed HTLCs...</span>
          </div>
        )}
        {!hasWallet && !onChainLoading && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{
              background: adminOverride ? "rgba(168,85,247,0.07)" : "rgba(6,182,212,0.07)",
              border: adminOverride ? "1px solid rgba(168,85,247,0.25)" : "1px solid rgba(6,182,212,0.2)",
            }}
          >
            <Wallet className={`w-3.5 h-3.5 flex-shrink-0 ${adminOverride ? "text-violet-400" : "text-cyan-400"}`} />
            <span className={adminOverride ? "text-violet-300/80" : "text-cyan-300/80"}>
              {adminOverride
                ? "Admin view — showing all platform refunds across all wallets."
                : "Connect a wallet to see your refunds. No wallet connected — nothing to show."}
            </span>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Claimable", value: claimable.length, color: "text-amber-400", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)" },
            { label: "Claimed", value: claimed.length, color: "text-emerald-400", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.25)" },
            { label: "Refunded", value: refunded.length, color: "text-cyan-400", bg: "rgba(6,182,212,0.1)", border: "rgba(6,182,212,0.25)" },
            { label: "At Risk", value: `$${claimable.reduce((s, r) => s + r.usdValue, 0).toFixed(2)}`, color: "text-foreground", bg: "var(--muted)", border: "var(--border)" },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl p-3 text-center"
              style={{ background: stat.bg, border: `1px solid ${stat.border}` }}>
              <div className={`text-lg font-bold font-mono ${stat.color}`}>{stat.value}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Claim All batch button — only shown when 2+ CLAIMABLE HTLCs */}
        {claimable.length >= 2 && (
          <div className="flex justify-end">
            <ClaimAllButton claimable={claimable} />
          </div>
        )}

        {refunds.length === 0 && (
          <div className="py-16 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <CheckCircle2 className="w-8 h-8 text-emerald-400/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No refunds needed</p>
            <p className="text-xs text-muted-foreground/60 mt-1">All swaps settled successfully</p>
          </div>
        )}

        {refunds.map(refund => (
          <RefundCard key={refund.id} refund={refund} onOpenDetail={setSelectedHtlcId} />
        ))}
      </div>

      <HtlcDetailDrawer htlcId={selectedHtlcId} onClose={() => setSelectedHtlcId(null)} />
    </>
  );
}
