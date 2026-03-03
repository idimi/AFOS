import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { chatRouter } from "./routers/chat";
import { btcHtlcRouter } from "./routers/btcHtlc";
import { pathFinderRouter } from "./pathFinder";
import { analyticsRouter } from "./routers/analytics";
import { htlcWalletRouter } from "./routers/htlcWallet";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  chat: chatRouter,
  btcHtlc: btcHtlcRouter,
  pathFinder: pathFinderRouter,
  analytics: analyticsRouter,
  htlcWallet: htlcWalletRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
