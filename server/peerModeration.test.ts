import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Tests for peer moderation features:
 * - peerReports (report, listAll, updateStatus)
 * - peerMutes (mute, unmute, isMuted, listMuted)
 *
 * We mock getDb() to return a fake Drizzle-like object that chains
 * .insert().values(), .select().from().where().orderBy(), etc.
 */

// ─── Shared state for mock ──────────────────────────────────────────────────
const mockReports: any[] = [];
const mockMutes: any[] = [];
let nextReportId = 1;
let nextMuteId = 1;

// Build a chainable mock that mimics Drizzle's query builder
function makeMockDb() {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(async (row: any) => {
        // Detect which table by inspecting the row keys
        if ("reason" in row) {
          mockReports.push({ id: nextReportId++, ...row, createdAt: new Date() });
        } else if ("muterPeerId" in row) {
          mockMutes.push({ id: nextMuteId++, ...row, createdAt: new Date() });
        }
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => {
        // Return an object with both .where() and .orderBy() that can chain
        const chainable = {
          where: vi.fn(() => ({
            orderBy: vi.fn(() => [...mockMutes]),
            // Also return as array for non-chained usage
            then: undefined as any,
            length: mockMutes.length,
            [Symbol.iterator]: mockMutes[Symbol.iterator]?.bind(mockMutes),
          })),
          orderBy: vi.fn(() => [...mockReports]),
        };
        // Make .where() return something array-like for isMuted check
        chainable.where = vi.fn(() => {
          // Return array directly (for isMuted which doesn't chain .orderBy)
          const result = [...mockMutes];
          (result as any).orderBy = vi.fn(() => [...mockMutes]);
          return result;
        });
        return chainable;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: any) => ({
        where: vi.fn(async () => {
          // Apply status update
          if (patch.status && mockReports.length > 0) {
            mockReports[0].status = patch.status;
          }
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        mockMutes.length = 0;
      }),
    })),
  };
}

vi.mock("./db", () => ({
  getDb: vi.fn(() => makeMockDb()),
}));

// ─── Context helpers ────────────────────────────────────────────────────────

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── peerReports Tests ──────────────────────────────────────────────────────

describe("peerReports", () => {
  beforeEach(() => {
    mockReports.length = 0;
    nextReportId = 1;
  });

  it("submits a report with all fields", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerReports.report({
      reporterPeerId: "peer-alice-123",
      reportedPeerId: "peer-bob-456",
      reason: "spam",
      details: "Flooding chat with ads",
    });
    expect(result).toEqual({ success: true });
    expect(mockReports).toHaveLength(1);
    expect(mockReports[0].reason).toBe("spam");
    expect(mockReports[0].status).toBe("pending");
    expect(mockReports[0].details).toBe("Flooding chat with ads");
  });

  it("submits a report without optional details", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerReports.report({
      reporterPeerId: "peer-alice-123",
      reportedPeerId: "peer-bob-456",
      reason: "suspicious_activity",
    });
    expect(result).toEqual({ success: true });
    expect(mockReports).toHaveLength(1);
    expect(mockReports[0].details).toBeNull();
  });

  it("accepts all valid reason types", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const reasons = ["spam", "suspicious_activity", "fake_quotes", "harassment", "other"] as const;
    for (const reason of reasons) {
      mockReports.length = 0;
      const result = await caller.peerReports.report({
        reporterPeerId: "peer-a",
        reportedPeerId: "peer-b",
        reason,
      });
      expect(result).toEqual({ success: true });
      expect(mockReports[0].reason).toBe(reason);
    }
  });

  it("lists all reports via listAll", async () => {
    mockReports.push({
      id: 1,
      reporterPeerId: "peer-a",
      reportedPeerId: "peer-b",
      reason: "spam",
      details: null,
      status: "pending",
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const reports = await caller.peerReports.listAll();
    expect(Array.isArray(reports)).toBe(true);
    expect(reports.length).toBeGreaterThanOrEqual(1);
  });

  it("updates report status to reviewed", async () => {
    mockReports.push({
      id: 1,
      reporterPeerId: "peer-a",
      reportedPeerId: "peer-b",
      reason: "harassment",
      details: null,
      status: "pending",
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerReports.updateStatus({
      id: 1,
      status: "reviewed",
    });
    expect(result).toEqual({ success: true });
  });

  it("updates report status to actioned", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerReports.updateStatus({
      id: 1,
      status: "actioned",
    });
    expect(result).toEqual({ success: true });
  });

  it("updates report status to dismissed", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerReports.updateStatus({
      id: 1,
      status: "dismissed",
    });
    expect(result).toEqual({ success: true });
  });
});

// ─── peerMutes Tests ────────────────────────────────────────────────────────

describe("peerMutes", () => {
  beforeEach(() => {
    mockMutes.length = 0;
    nextMuteId = 1;
  });

  it("mutes a peer successfully", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerMutes.mute({
      muterPeerId: "peer-alice",
      mutedPeerId: "peer-bob",
    });
    expect(result).toEqual({ success: true });
  });

  it("unmutes a peer successfully", async () => {
    mockMutes.push({
      id: 1,
      muterPeerId: "peer-alice",
      mutedPeerId: "peer-bob",
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerMutes.unmute({
      muterPeerId: "peer-alice",
      mutedPeerId: "peer-bob",
    });
    expect(result).toEqual({ success: true });
  });

  it("checks if a peer is muted", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.peerMutes.isMuted({
      muterPeerId: "peer-alice",
      mutedPeerId: "peer-bob",
    });
    expect(result).toHaveProperty("muted");
    expect(typeof result.muted).toBe("boolean");
  });

  it("lists muted peers", async () => {
    mockMutes.push({
      id: 1,
      muterPeerId: "peer-alice",
      mutedPeerId: "peer-bob",
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const muted = await caller.peerMutes.listMuted({
      muterPeerId: "peer-alice",
    });
    expect(Array.isArray(muted)).toBe(true);
  });
});
