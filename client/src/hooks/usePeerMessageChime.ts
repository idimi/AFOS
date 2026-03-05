import { useEffect, useRef } from "react";

/**
 * Plays a subtle two-tone chime using the Web Audio API when the unread
 * peer message count increases and the user is not on the Network page.
 *
 * No external audio files required — the chime is synthesised entirely
 * with OscillatorNode + GainNode.
 */
export function usePeerMessageChime(
  unreadCount: number,
  isNetworkPage: boolean
) {
  const prevCountRef = useRef(unreadCount);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = unreadCount;

    // Only chime when count increases, user is away from Network page, and not muted
    if (unreadCount <= prev || isNetworkPage) return;
    if (localStorage.getItem('afos:chime-muted') === 'true') return;

    // Lazily create AudioContext on first use (browser requires user gesture
    // before the first AudioContext can be created; we create it here inside
    // a state-change effect which is safe after the first user interaction).
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext();
      } catch {
        return; // AudioContext not supported
      }
    }

    const ctx = audioCtxRef.current;

    // Resume if suspended (auto-play policy)
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      // Soft attack + decay envelope
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playTone(880, now, 0.22);        // A5 — first note
    playTone(1100, now + 0.18, 0.18); // C#6 — second note (slight overlap)
  }, [unreadCount, isNetworkPage]);
}
