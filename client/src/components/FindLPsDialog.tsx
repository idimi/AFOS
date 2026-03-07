/**
 * FindLPsDialog — lets users discover and invite LP peers to register for a specific pair.
 *
 * Two flows:
 * 1. Online peers tab: shows all currently connected signaling peers that are NOT already
 *    registered for the current pair. User can click "Invite" to send them an lp_invite
 *    message via the signaling server.
 * 2. Invite link tab: generates a shareable URL that pre-fills the LP registration form
 *    with the requested pair, so the user can send it to anyone out-of-band.
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLightPeer } from "@/contexts/LightPeerContext";
import { trpc } from "@/lib/trpc";
import { Check, Copy, ExternalLink, Radio, UserPlus, Users, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface FindLPsDialogProps {
  open: boolean;
  onClose: () => void;
  pair: string; // e.g. "SOL/ETH"
}

export function FindLPsDialog({ open, onClose, pair }: FindLPsDialogProps) {
  const lightPeer = useLightPeer();
  const [tab, setTab] = useState<"online" | "link">("online");
  const [invitedPeers, setInvitedPeers] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Fetch the current peer list from the signaling server
  const { data: peerList, isLoading } = trpc.chat.getPeerList.useQuery(undefined, {
    refetchInterval: 10_000,
    enabled: open,
  });

  // Filter: show peers that are NOT already registered for this pair
  const uninvitedPeers = (peerList ?? []).filter(p => {
    if (p.peerId === lightPeer.peerId) return false; // don't show self
    const alreadyHasPair = (p.pairs ?? []).some(
      (pr: string) => pr === pair || pr === pair.split("/").reverse().join("/")
    );
    return !alreadyHasPair;
  });

  // Peers already registered for this pair
  const registeredPeers = (peerList ?? []).filter(p => {
    if (p.peerId === lightPeer.peerId) return false;
    return (p.pairs ?? []).some(
      (pr: string) => pr === pair || pr === pair.split("/").reverse().join("/")
    );
  });

  // Generate shareable invite link
  const inviteLink = `${window.location.origin}/?lp_invite_pair=${encodeURIComponent(pair)}`;

  const handleInvite = useCallback((targetPeerId: string, alias: string) => {
    lightPeer.sendLpInvite(targetPeerId, pair, lightPeer.peerAlias ?? "Anonymous");
    setInvitedPeers(prev => { const next = new Set(prev); next.add(targetPeerId); return next; });
    toast.success(`Invite sent to ${alias}`, {
      description: `Asked them to register as LP for ${pair}`,
    });
  }, [lightPeer, pair]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  }, [inviteLink]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setInvitedPeers(new Set());
      setCopied(false);
      setTab("online");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        className="max-w-md"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="w-4 h-4 text-cyan-400" />
            Find LPs for {pair}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Invite peers to register as liquidity providers for this pair so you can get live P2P quotes.
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
          {(["online", "link"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all"
              style={{
                background: tab === t ? "var(--card)" : "transparent",
                color: tab === t ? "var(--foreground)" : "var(--muted-foreground)",
                boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
              }}
            >
              {t === "online" ? <Wifi className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
              {t === "online" ? "Online Peers" : "Invite Link"}
            </button>
          ))}
        </div>

        {tab === "online" && (
          <div className="space-y-3">
            {/* Already registered */}
            {registeredPeers.length > 0 && (
              <div>
                <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  Already LP for {pair} ({registeredPeers.length})
                </div>
                <div className="space-y-1.5">
                  {registeredPeers.map(p => (
                    <div
                      key={p.peerId}
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                        </span>
                        <span className="text-xs font-mono text-foreground">{p.alias ?? p.peerId.slice(0, 12)}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{p.peerId.slice(0, 8)}…</span>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono">Active LP</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Peers to invite */}
            <div>
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Users className="w-2.5 h-2.5" />
                {isLoading ? "Loading peers…" : `Online peers not yet LP for ${pair} (${uninvitedPeers.length})`}
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                </div>
              ) : uninvitedPeers.length === 0 ? (
                <div className="py-6 text-center">
                  <Users className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {(peerList ?? []).length === 0
                      ? "No peers currently online on the signaling network."
                      : `All online peers are already registered as LP for ${pair}.`}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Use the Invite Link tab to share with peers out-of-band.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {uninvitedPeers.map(p => {
                    const alreadyInvited = invitedPeers.has(p.peerId);
                    return (
                      <div
                        key={p.peerId}
                        className="flex items-center justify-between px-3 py-2 rounded-lg"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
                          </span>
                          <span className="text-xs font-mono text-foreground truncate">{p.alias ?? p.peerId.slice(0, 12)}</span>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{p.peerId.slice(0, 8)}…</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={alreadyInvited}
                          onClick={() => handleInvite(p.peerId, p.alias ?? p.peerId.slice(0, 8))}
                          className="h-6 px-2 text-[10px] shrink-0 ml-2"
                          style={alreadyInvited ? { color: "var(--muted-foreground)" } : { color: "#06b6d4", borderColor: "rgba(6,182,212,0.4)" }}
                        >
                          {alreadyInvited ? (
                            <><Check className="w-2.5 h-2.5 mr-1" />Invited</>
                          ) : (
                            <><UserPlus className="w-2.5 h-2.5 mr-1" />Invite</>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "link" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Share this link with anyone you want to invite as an LP for <strong className="text-foreground">{pair}</strong>. When they open it, the LP registration form will be pre-filled with this pair.
            </p>

            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg font-mono text-[11px] break-all"
              style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
            >
              <span className="flex-1 truncate">{inviteLink}</span>
            </div>

            <Button
              className="w-full h-9 text-xs font-semibold"
              onClick={handleCopyLink}
              style={{
                background: copied ? "rgba(16,185,129,0.15)" : "rgba(6,182,212,0.15)",
                border: `1px solid ${copied ? "rgba(16,185,129,0.4)" : "rgba(6,182,212,0.4)"}`,
                color: copied ? "#34d399" : "#06b6d4",
              }}
            >
              {copied ? (
                <><Check className="w-3.5 h-3.5 mr-1.5" />Copied!</>
              ) : (
                <><Copy className="w-3.5 h-3.5 mr-1.5" />Copy Invite Link</>
              )}
            </Button>

            <div className="rounded-lg p-3 text-[10px] text-muted-foreground space-y-1" style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
              <p className="font-semibold text-foreground">How it works</p>
              <p>1. Send this link to a peer you trust to provide liquidity.</p>
              <p>2. They open the link, connect their wallet, and enable LP mode with {pair} pre-selected.</p>
              <p>3. Once they register on the signaling network, their quotes will appear in your order book automatically.</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
