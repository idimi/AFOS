/**
 * settings router
 * Provides settings.get and settings.save procedures for persisting
 * per-user trading preferences to the database.
 *
 * Both procedures are protected — the user must be authenticated.
 * The openId from the session is used as the key (no wallet address required).
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getUserSettings, upsertUserSettings } from "../db";
import { DEFAULT_USER_SETTINGS } from "../../drizzle/schema";

const preferredRouteEnum = z.enum(["intercomswap", "jupiter", "oneinch", "best"]);
const themeEnum = z.enum(["dark", "light", "system"]);

export const settingsRouter = router({
  /**
   * Load the current user's settings.
   * Returns defaults when no row exists yet — safe to call on first load.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getUserSettings(ctx.user.openId);
    return {
      maxTxAmountUsd: settings.maxTxAmountUsd ?? DEFAULT_USER_SETTINGS.maxTxAmountUsd,
      autoConfirm: settings.autoConfirm ?? DEFAULT_USER_SETTINGS.autoConfirm,
      slippagePct: settings.slippagePct ?? DEFAULT_USER_SETTINGS.slippagePct,
      preferredRoute: settings.preferredRoute ?? DEFAULT_USER_SETTINGS.preferredRoute,
      theme: settings.theme ?? DEFAULT_USER_SETTINGS.theme,
    };
  }),

  /**
   * Save (upsert) the current user's settings.
   * Accepts a partial patch — only provided fields are written.
   */
  save: protectedProcedure
    .input(
      z.object({
        maxTxAmountUsd: z.number().int().min(1).max(1_000_000).optional(),
        autoConfirm: z.boolean().optional(),
        slippagePct: z.string().regex(/^\d+(\.\d+)?$/, "Must be a numeric string like '0.5'").optional(),
        preferredRoute: preferredRouteEnum.optional(),
        theme: themeEnum.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await upsertUserSettings(ctx.user.openId, input);
      // Return the full settings after save so the client can update its cache
      return getUserSettings(ctx.user.openId);
    }),
});
