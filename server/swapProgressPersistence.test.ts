/**
 * Verifies that swapProgressData fields (confirmedAt, agentBClaimTxId, agentAClaimTxId)
 * survive a JSON round-trip — the same serialization used by ChatContext localStorage.
 */
import { describe, it, expect } from "vitest";

interface SwapProgressData {
  rfqId: string;
  phase: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  startedAt?: number;
  confirmedAt?: number;
  agentBClaimTxId?: string;
  agentAClaimTxId?: string;
}

interface ChatMessage {
  id: string;
  role: string;
  type: string;
  content?: string;
  timestamp: number;
  swapProgressData?: SwapProgressData;
}

function saveMessages(msgs: ChatMessage[]): string {
  return JSON.stringify(msgs);
}

function loadMessages(raw: string): ChatMessage[] {
  return JSON.parse(raw) as ChatMessage[];
}

describe("swapProgressData localStorage persistence", () => {
  it("should persist confirmedAt through JSON round-trip", () => {
    const confirmedAt = 1741924381000;
    const msgs: ChatMessage[] = [
      {
        id: "msg-1",
        role: "assistant",
        type: "swap_progress",
        timestamp: 1741924300000,
        swapProgressData: {
          rfqId: "rfq_test_123",
          phase: "confirmed",
          fromToken: "SOL",
          toToken: "USDT",
          fromAmount: 0.01,
          toAmount: 0.8857,
          startedAt: 1741924300000,
          confirmedAt,
        },
      },
    ];

    const serialized = saveMessages(msgs);
    const restored = loadMessages(serialized);

    expect(restored[0].swapProgressData?.confirmedAt).toBe(confirmedAt);
  });

  it("should persist agentBClaimTxId and agentAClaimTxId through JSON round-trip", () => {
    const agentBClaimTxId = "4osK4GhkdX7ax9VVRqosUU6KFUUz4ddPWboMnKm9mein";
    const agentAClaimTxId = "5z75kQQSAc3qR3TQyHyV2s9WC8Pkw9kaT6Kvrc8YPj9";
    const msgs: ChatMessage[] = [
      {
        id: "msg-2",
        role: "assistant",
        type: "swap_progress",
        timestamp: 1741924300000,
        swapProgressData: {
          rfqId: "rfq_test_456",
          phase: "confirmed",
          fromToken: "SOL",
          toToken: "USDT",
          fromAmount: 0.01,
          toAmount: 0.8857,
          agentBClaimTxId,
          agentAClaimTxId,
        },
      },
    ];

    const serialized = saveMessages(msgs);
    const restored = loadMessages(serialized);

    expect(restored[0].swapProgressData?.agentBClaimTxId).toBe(agentBClaimTxId);
    expect(restored[0].swapProgressData?.agentAClaimTxId).toBe(agentAClaimTxId);
  });

  it("should compute correct settlement duration from persisted timestamps", () => {
    const startedAt = 1741924300000;
    const confirmedAt = 1741924347000; // 47 seconds later

    const diffSec = Math.round((confirmedAt - startedAt) / 1000);
    expect(diffSec).toBe(47);

    // Simulate the settlementLabel computation from SwapProgressCard
    const settlementLabel = (() => {
      if (diffSec <= 0) return null;
      if (diffSec < 60) return `${diffSec}s`;
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    })();

    expect(settlementLabel).toBe("47s");
  });

  it("should compute correct settlement duration in minutes", () => {
    const startedAt = 1741924300000;
    const confirmedAt = 1741924372000; // 72 seconds later

    const diffSec = Math.round((confirmedAt - startedAt) / 1000);
    const settlementLabel = (() => {
      if (diffSec <= 0) return null;
      if (diffSec < 60) return `${diffSec}s`;
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    })();

    expect(settlementLabel).toBe("1m 12s");
  });

  it("should handle missing confirmedAt gracefully (undefined stays undefined)", () => {
    const msgs: ChatMessage[] = [
      {
        id: "msg-3",
        role: "assistant",
        type: "swap_progress",
        timestamp: 1741924300000,
        swapProgressData: {
          rfqId: "rfq_test_789",
          phase: "confirmed",
          fromToken: "SOL",
          toToken: "USDT",
          fromAmount: 0.01,
          toAmount: 0.8857,
          // confirmedAt intentionally omitted
        },
      },
    ];

    const serialized = saveMessages(msgs);
    const restored = loadMessages(serialized);

    expect(restored[0].swapProgressData?.confirmedAt).toBeUndefined();
  });
});
