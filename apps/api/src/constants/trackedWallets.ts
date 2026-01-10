export const TRACKED_WALLETS = ["0xabe50375A4064C5d5E0BE39063082e8eeF144097"] as const;

export type TrackedWallet = (typeof TRACKED_WALLETS)[number];

export const DEFAULT_WALLET = TRACKED_WALLETS[0];
