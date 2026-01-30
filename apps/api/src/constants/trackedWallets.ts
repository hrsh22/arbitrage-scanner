export const TRACKED_WALLETS = [
  "0x7d9Fe5aA506d1128faFaE07A0FC6d0881F239c15", // Bonding V2
  "0x9E53f8578f9cC704a7B45bF53D2c7B7688ab80D9", // MidRisk V2
  "0x08cFcA80B1035242aEe5096508b181565B2b70A3", // HighRisk V2
] as const;

export type TrackedWallet = (typeof TRACKED_WALLETS)[number];

export const DEFAULT_WALLET = TRACKED_WALLETS[0];
