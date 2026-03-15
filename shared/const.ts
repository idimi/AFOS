/** Canonical set of supported blockchain networks across the AFOS platform. */
export type SupportedChain = 'solana' | 'ethereum' | 'bitcoin' | 'trac_network';

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
export const SUPPORTED_WALLETS_TEXT = "Phantom, MetaMask, Tap Wallet";

/**
 * Fixed network fee charged by the Trac Network for every TNK transfer.
 * The agent's escrow wallet must hold at least (swap_amount + TNK_NETWORK_FEE_TNK)
 * so the autonomous claim can always broadcast the on-chain transfer without
 * requiring a manual top-up.
 *
 * Source: trac-msb FEE constant = 0x00000000001C9C38 raw units = 0.03 TNK
 */
export const TNK_NETWORK_FEE_TNK = 0.03;
