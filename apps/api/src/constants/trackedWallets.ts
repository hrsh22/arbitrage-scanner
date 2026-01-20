export const TRACKED_WALLETS = [
  "0xabe50375A4064C5d5E0BE39063082e8eeF144097", // Default
  "0x4884D7cFD4cDaf76C183D974f41D05381DE006DD", // Bonding
  "0x3bb59DdB9043d40AeF6a38bb4DF85F74a5Ac899b", // Hedging
] as const;

export type TrackedWallet = (typeof TRACKED_WALLETS)[number];

export const DEFAULT_WALLET = TRACKED_WALLETS[0];
