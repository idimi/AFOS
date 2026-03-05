import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { peerReports } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const REPORT_REASONS = ["spam", "suspicious_activity", "fake_quotes", "harassment", "other"] as const;
const REPORT_STATUSES = ["pending", "reviewed", "dismissed", "actioned"] as const;

export const peerReportsRouter = router({
  /** Submit a report against a peer (public — any peer can report) */
  report: publicProcedure
    .input(z.object({
      reporterPeerId: z.string().min(1).max(128),
      reportedPeerId: z.string().min(1).max(128),
      reason: z.enum(REPORT_REASONS),
      details: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.insert(peerReports).values({
        reporterPeerId: input.reporterPeerId,
        reportedPeerId: input.reportedPeerId,
        reason: input.reason,
        details: input.details ?? null,
        status: "pending",
      });
      return { success: true };
    }),

  /** List all reports (admin-facing, no auth guard — admin panel is password-protected at UI level) */
  listAll: publicProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(peerReports)
        .orderBy(desc(peerReports.createdAt));
      return rows;
    }),

  /** List all reports (legacy alias with status filter) */
  listReports: publicProcedure
    .input(z.object({
      status: z.enum(["pending", "reviewed", "dismissed", "actioned", "all"]).default("all"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(peerReports)
        .orderBy(desc(peerReports.createdAt));
      if (input.status === "all") return rows;
      return rows.filter(r => r.status === input.status);
    }),

  /** Update report status (admin panel action) */
  updateStatus: publicProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(REPORT_STATUSES),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db
        .update(peerReports)
        .set({ status: input.status })
        .where(eq(peerReports.id, input.id));
      return { success: true };
    }),
});
