export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * Set to true while the product is in beta.
 * Flip to false here to remove all BETA badges across the entire app at once.
 */
export const IS_BETA = true;

/** Canonical list of supported wallet names shown in connect prompts across the app. */
export const SUPPORTED_WALLETS_TEXT = "Phantom, MetaMask, Coinbase, Solflare, Tap Wallet";
