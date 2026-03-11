import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VaultInstanceConfig } from "../config/types.js";

// Mock dependencies BEFORE importing modules under test
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  vaultPositions: {},
  vaultTrades: {},
  vaultAllocations: {},
  vaultNavHistory: {},
}));

vi.mock("../env.js", () => ({
  env: {
    VAULT_MODE: "simulation",
    POLYGON_RPC_URL: "https://polygon-rpc.com",
  },
}));

// Import the modules under test
import {
  parseOrderBookEntries,
  calculateEffectivePrice,
  checkEffectivePrice,
  type OrderBookLevel,
} from "../services/orderBookUtils.js";

import {
  isValidOpportunity,
  calculatePPH,
  calculateExpectedProfit,
  calculateMaxInvestmentStats,
} from "../services/strategyEngine.js";

/**
 * ============================================================================
 * HELPER FUNCTIONS - Address Validation (Pure Functions for Testing)
 * ============================================================================
 */

/**
 * Validates if a string is a valid Ethereum address (0x + 40 hex characters)
 */
function isValidAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (!address.startsWith("0x")) return false;
  if (address.length !== 42) return false;
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Validates if a string is a valid private key (0x + 64 hex characters)
 */
function isValidPrivateKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (!key.startsWith("0x")) return false;
  if (key.length !== 66) return false;
  return /^0x[0-9a-fA-F]{64}$/.test(key);
}

/**
 * Normalizes an address to lowercase for consistent comparison
 */
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Checks if two addresses are equal (case-insensitive)
 */
function addressesEqual(addr1: string, addr2: string): boolean {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
}

/**
 * Validates signature type (must be 0, 1, or 2)
 */
function isValidSignatureType(type: number): boolean {
  return type === 0 || type === 1 || type === 2;
}

/**
 * ============================================================================
 * TEST FIXTURES
 * ============================================================================
 */

const VALID_ADDRESS_1 = "0x066A4678935b78FA4E89e914dBE8F077764F0c74";
const VALID_ADDRESS_2 = "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525";
const VALID_ADDRESS_3 = "0x5Eb9f355cCa830Bc1bB928D24509e278A0804b6b";
const VALID_PRIVATE_KEY = "0x" + "a".repeat(64);

function createBaseConfig(): VaultInstanceConfig {
  return {
    id: 1,
    name: "TestVault",
    enabled: true,
    type: "bot",
    vaultAddress: VALID_ADDRESS_1,
    safeAddress: VALID_ADDRESS_3,
    allocatorNavSignerKeyEnv: "TEST_ALLOCATOR_KEY",
    safeOperatorKeyEnv: "TEST_SAFE_KEY",
    tradingSignerKeyEnv: "TEST_TRADING_KEY",
    tradingFunderAddressEnv: "TEST_FUNDER_ADDRESS",
    tradingSignatureType: 2,
    betSize: 1.0,
    dailyBudget: Infinity,
    minOdds: 0.9,
    maxOdds: 0.995,
    maxHoursGeneral: 24,
    maxHoursForHighOdds: 6,
    highOddsThreshold: 0.99,
    categoryTimeLimits: {},
    skipCategories: [],
    minWalletReserve: 0,
    maxDailyLoss: Infinity,
    enableEarlyExit: true,
    earlyExitMinPrice: 0.9995,
    useMarketOrders: true,
    vaultReserveUsdc: 0,
    minAllocationAmountUsdc: 1,
    maxDeployedRatio: 0.25,
    marketFetchMaxEvents: 2000,
    hedging: {
      enabled: false,
      dropThresholdPercent: 60,
      multiplier: 2,
      spreadTolerance: 0.1,
      minPositionAgeMinutes: 0,
      onlyNearResolution: false,
      nearResolutionMinutes: 60,
      skipCategories: [],
    },
    navRefreshIntervalMin: 2,
    reconciliationIntervalMin: 2,
    tradingScanIntervalMin: 1,
    resolutionCheckIntervalMin: 5,
    defaultMode: "simulation",
  };
}

/**
 * ============================================================================
 * PART 1: Parser Validation Tests (parseOrderBookEntries)
 * ============================================================================
 */
describe("Parser Functions", () => {
  describe("parseOrderBookEntries", () => {
    it("parses valid order book entries correctly", () => {
      const entries = [
        { price: "0.95", size: "100.5" },
        { price: "0.96", size: "200" },
        { price: "0.97", size: "150.25" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ price: 0.95, size: 100.5 });
      expect(result[1]).toEqual({ price: 0.96, size: 200 });
      expect(result[2]).toEqual({ price: 0.97, size: 150.25 });
    });

    it("filters out entries with zero or negative size", () => {
      const entries = [
        { price: "0.95", size: "100" },
        { price: "0.96", size: "0" },
        { price: "0.97", size: "-50" },
        { price: "0.98", size: "200" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ price: 0.95, size: 100 });
      expect(result[1]).toEqual({ price: 0.98, size: 200 });
    });

    it("filters out entries with invalid (non-finite) prices", () => {
      const entries = [
        { price: "0.95", size: "100" },
        { price: "invalid", size: "200" },
        { price: "NaN", size: "150" },
        { price: "Infinity", size: "100" },
        { price: "-Infinity", size: "100" },
        { price: "0.98", size: "200" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ price: 0.95, size: 100 });
      expect(result[1]).toEqual({ price: 0.98, size: 200 });
    });

    it("filters out entries with invalid (non-finite) sizes", () => {
      const entries = [
        { price: "0.95", size: "100" },
        { price: "0.96", size: "invalid" },
        { price: "0.97", size: "NaN" },
        { price: "0.98", size: "Infinity" },
        { price: "0.99", size: "200" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ price: 0.95, size: 100 });
      expect(result[1]).toEqual({ price: 0.99, size: 200 });
    });

    it("returns empty array for empty input", () => {
      const result = parseOrderBookEntries([]);
      expect(result).toEqual([]);
    });

    it("handles very small decimal values", () => {
      const entries = [
        { price: "0.0001", size: "0.0001" },
        { price: "0.9999", size: "0.0001" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toHaveLength(2);
      expect(result[0]!.price).toBe(0.0001);
      expect(result[0]!.size).toBe(0.0001);
    });

    it("handles scientific notation in strings", () => {
      const entries = [
        { price: "1e-4", size: "100" },
        { price: "0.95", size: "1e2" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toHaveLength(2);
      expect(result[0]!.price).toBe(0.0001);
      expect(result[1]!.size).toBe(100);
    });

    it("filters out all invalid entries and returns empty array", () => {
      const entries = [
        { price: "invalid", size: "100" },
        { price: "0.95", size: "0" },
        { price: "NaN", size: "NaN" },
      ];

      const result = parseOrderBookEntries(entries);

      expect(result).toEqual([]);
    });
  });
});

/**
 * ============================================================================
 * PART 2: Guardrail/Phase Transition Tests (checkEffectivePrice)
 * ============================================================================
 */
describe("Guardrail Functions - Price Validation", () => {
  describe("checkEffectivePrice", () => {
    const maxOdds = 0.99;

    it("accepts order when effective price is below maxOdds", () => {
      const asks: OrderBookLevel[] = [{ price: 0.95, size: 1000 }];

      const result = checkEffectivePrice(asks, 10, maxOdds);

      expect(result.acceptable).toBe(true);
      expect(result.effectivePrice).toBe(0.95);
      expect(result.canFill).toBe(true);
      expect(result.profitIfWin).toBeGreaterThan(0);
    });

    it("rejects order when effective price exceeds maxOdds", () => {
      const asks: OrderBookLevel[] = [{ price: 0.995, size: 1000 }];

      const result = checkEffectivePrice(asks, 10, maxOdds);

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain("exceeds max");
    });

    it("rejects order when effective price >= 1.0 (guaranteed loss)", () => {
      const asks: OrderBookLevel[] = [{ price: 1.0, size: 1000 }];

      const result = checkEffectivePrice(asks, 10, maxOdds);

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain("Guaranteed loss");
    });

    it("rejects order when insufficient liquidity", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.95, size: 5 }, // Only $5 worth at this price
      ];

      const result = checkEffectivePrice(asks, 100, maxOdds);

      expect(result.acceptable).toBe(false);
      expect(result.canFill).toBe(false);
      expect(result.reason).toContain("Insufficient liquidity");
    });

    it("rejects empty order book", () => {
      const result = checkEffectivePrice([], 10, maxOdds);

      expect(result.acceptable).toBe(false);
      expect(result.canFill).toBe(false);
      expect(result.reason).toContain("No asks");
    });

    it("calculates effective price correctly across multiple levels", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 5 }, // $4.50
        { price: 0.95, size: 5 }, // $4.75
        { price: 1.0, size: 100 }, // Remaining $0.75 at worse price
      ];

      const result = checkEffectivePrice(asks, 10, 0.99);

      expect(result.acceptable).toBe(true);
      expect(result.canFill).toBe(true);
      // Effective price should be weighted average
      expect(result.effectivePrice).toBeGreaterThan(0.9);
      expect(result.effectivePrice).toBeLessThan(0.96);
    });

    it("tracks bestAsk separately from effectivePrice", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 1 },
        { price: 0.95, size: 100 },
      ];

      const result = checkEffectivePrice(asks, 50, maxOdds);

      expect(result.bestAsk).toBe(0.9);
      expect(result.effectivePrice).toBeGreaterThan(0.9);
    });

    it("calculates profitIfWin correctly", () => {
      const asks: OrderBookLevel[] = [{ price: 0.9, size: 100 }];

      const result = checkEffectivePrice(asks, 90, maxOdds);

      // Buying $90 worth at 0.90 = 100 tokens
      // If win: 100 tokens * $1 = $100
      // Profit: $100 - $90 = $10
      expect(result.tokensReceived).toBe(100);
      expect(result.profitIfWin).toBe(10);
      expect(result.profitIfWin).toBe(10);
    });
  });

  describe("calculateEffectivePrice", () => {
    it("returns canFill=false for empty asks", () => {
      const result = calculateEffectivePrice([], 100);

      expect(result.canFill).toBe(false);
      expect(result.tokensReceived).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it("sorts asks by price (lowest first)", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.95, size: 100 },
        { price: 0.9, size: 100 },
        { price: 0.98, size: 100 },
      ];

      const result = calculateEffectivePrice(asks, 50);

      // Should fill entirely from the 0.90 level (cheapest)
      expect(result.canFill).toBe(true);
      expect(result.effectivePrice).toBe(0.9);
    });

    it("fills across multiple levels when needed", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 50 }, // $45 available
        { price: 0.95, size: 50 }, // $47.50 available
      ];

      const result = calculateEffectivePrice(asks, 80);

      expect(result.canFill).toBe(true);
      // Spends $45 at 0.90 (50 tokens) + $35 at 0.95 (36.84 tokens)
      // Total: 86.84 tokens for $80 = ~0.921 effective price
      expect(result.effectivePrice).toBeCloseTo(0.921, 2);
    });

    it("returns canFill=false when liquidity is insufficient", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 10 }, // Only $9 available
      ];

      const result = calculateEffectivePrice(asks, 100);

      expect(result.canFill).toBe(false);
      expect(result.tokensReceived).toBe(10); // Got all available
    });

    it("handles exact fill at single level", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 100 }, // $90 available exactly
      ];

      const result = calculateEffectivePrice(asks, 90);

      expect(result.canFill).toBe(true);
      expect(result.effectivePrice).toBe(0.9);
      expect(result.tokensReceived).toBe(100);
      expect(result.totalCost).toBe(90);
    });

    it("allows small rounding tolerance (0.001) for partial fills", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 111.111 }, // $100 available
      ];

      const result = calculateEffectivePrice(asks, 100);

      expect(result.canFill).toBe(true);
    });

    it("rejects when remaining exceeds tolerance", () => {
      const asks: OrderBookLevel[] = [
        { price: 0.9, size: 100 }, // $90 available
      ];

      const result = calculateEffectivePrice(asks, 100);

      // Missing $10 is > 0.001 tolerance
      expect(result.canFill).toBe(false);
    });
  });
});

/**
 * ============================================================================
 * PART 3: Phase Transition Predicates (isValidOpportunity)
 * ============================================================================
 */
describe("Phase Transition Predicates - Opportunity Validation", () => {
  describe("isValidOpportunity", () => {
    let config: VaultInstanceConfig;

    beforeEach(() => {
      config = createBaseConfig();
    });

    it("accepts valid opportunity within all limits", () => {
      const result = isValidOpportunity(0.95, 12, config);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects when market is already closed (hoursUntilClose <= 0)", () => {
      const result = isValidOpportunity(0.95, 0, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("already closed");
    });

    it("rejects when market is past close (negative hours)", () => {
      const result = isValidOpportunity(0.95, -5, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("already closed");
    });

    it("rejects when buyPrice is below minOdds", () => {
      const result = isValidOpportunity(0.85, 12, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("below min");
    });

    it("rejects when buyPrice is at or above maxOdds", () => {
      const result = isValidOpportunity(0.995, 12, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("above max");
    });

    it("rejects when buyPrice exceeds maxOdds", () => {
      const result = isValidOpportunity(0.996, 12, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("above max");
    });

    it("accepts high odds when within maxHoursForHighOdds", () => {
      // 0.99 is >= highOddsThreshold (0.99), but resolves in 5 hours (< 6 max)
      const result = isValidOpportunity(0.99, 5, config);

      expect(result.valid).toBe(true);
    });

    it("rejects high odds when exceeding maxHoursForHighOdds", () => {
      // 0.992 is >= highOddsThreshold (0.99), but resolves in 8 hours (> 6 max)
      const result = isValidOpportunity(0.992, 8, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("threshold");
    });

    it("rejects when exceeding maxHoursGeneral", () => {
      const result = isValidOpportunity(0.95, 48, config);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Category limit");
    });

    it("rejects when tag is in skipCategories", () => {
      config.skipCategories = ["Crypto", "Politics"];

      const result = isValidOpportunity(0.95, 12, config, ["Crypto", "Technology"]);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("blocklist");
    });

    it("is case-insensitive for skipCategories matching", () => {
      config.skipCategories = ["crypto", "politics"];

      const result = isValidOpportunity(0.95, 12, config, ["CRYPTO", "Technology"]);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("blocklist");
    });

    it("applies category-specific time limits", () => {
      config.categoryTimeLimits = { Crypto: 3, Politics: 12 };

      const result = isValidOpportunity(0.95, 6, config, ["Crypto"]);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Category limit");
      expect(result.reason).toContain("3h");
    });

    it("uses lowest matching category limit", () => {
      config.categoryTimeLimits = { Crypto: 3, Politics: 12 };

      // Has both tags, should use the stricter limit (3 hours)
      const result = isValidOpportunity(0.95, 6, config, ["Politics", "Crypto"]);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("3h");
    });

    it("accepts when no category limits match", () => {
      config.categoryTimeLimits = { Crypto: 3 };

      const result = isValidOpportunity(0.95, 12, config, ["Politics"]);

      expect(result.valid).toBe(true);
    });

    it("accepts valid opportunity at boundary conditions", () => {
      // At exact minOdds
      const result1 = isValidOpportunity(0.9, 24, config);
      expect(result1.valid).toBe(true);

      // Just below highOddsThreshold (not subject to high odds rules)
      const result2 = isValidOpportunity(0.989, 24, config);
      expect(result2.valid).toBe(true);

      // At exact maxHoursGeneral
      const result3 = isValidOpportunity(0.95, 24, config);
      expect(result3.valid).toBe(true);

      // At high odds (>=0.99) but within maxHoursForHighOdds
      const result4 = isValidOpportunity(0.994, 5, config);
      expect(result4.valid).toBe(true);
    });

    it("handles empty tags array", () => {
      const result = isValidOpportunity(0.95, 12, config, []);

      expect(result.valid).toBe(true);
    });

    it("handles undefined tags", () => {
      const result = isValidOpportunity(0.95, 12, config, undefined);

      expect(result.valid).toBe(true);
    });
  });

  describe("calculatePPH", () => {
    it("calculates PPH correctly for valid inputs", () => {
      // Buy at 0.95, profit = 0.05, over 5 hours = 0.01 PPH
      const result = calculatePPH(0.95, 5);

      expect(result).toBeCloseTo(0.01, 4);
    });

    it("returns 0 for closed markets (hoursUntilClose <= 0)", () => {
      expect(calculatePPH(0.95, 0)).toBe(0);
      expect(calculatePPH(0.95, -5)).toBe(0);
    });

    it("returns higher PPH for faster resolution", () => {
      const pph5h = calculatePPH(0.95, 5);
      const pph10h = calculatePPH(0.95, 10);

      expect(pph5h).toBeGreaterThan(pph10h);
      expect(pph5h).toBe(pph10h * 2);
    });

    it("returns higher PPH for lower buy price", () => {
      const pph90 = calculatePPH(0.9, 10);
      const pph95 = calculatePPH(0.95, 10);

      expect(pph90).toBeGreaterThan(pph95);
    });

    it("handles very small time windows", () => {
      const result = calculatePPH(0.99, 0.1);

      expect(result).toBeCloseTo(0.1, 4); // 0.01 profit / 0.1 hours
    });
  });

  describe("calculateExpectedProfit", () => {
    it("calculates profit correctly", () => {
      expect(calculateExpectedProfit(0.95)).toBeCloseTo(0.05, 4);
      expect(calculateExpectedProfit(0.9)).toBeCloseTo(0.1, 4);
      expect(calculateExpectedProfit(0.99)).toBeCloseTo(0.01, 4);
    });

    it("returns 0 at price 1.0", () => {
      expect(calculateExpectedProfit(1.0)).toBe(0);
    });

    it("returns negative for price > 1.0", () => {
      expect(calculateExpectedProfit(1.05)).toBeCloseTo(-0.05, 4);
    });
  });

  describe("calculateMaxInvestmentStats", () => {
    it("calculates stats correctly for basic case", () => {
      const result = calculateMaxInvestmentStats(0.9, 100);

      expect(result.maxInvestment).toBe(100);
      expect(result.maxProfitPercent).toBeCloseTo(11.11, 1);
      expect(result.maxProfitAbsolute).toBeCloseTo(11.11, 1);
    });

    it("returns 0 maxInvestment when liquidity is 0", () => {
      const result = calculateMaxInvestmentStats(0.9, 0);

      expect(result.maxInvestment).toBe(0);
      // Profit percent and absolute are calculated from buyPrice, not liquidity
      expect(result.maxProfitPercent).toBeGreaterThan(0);
      expect(result.maxProfitAbsolute).toBe(0);
    });

    it("returns 0 profit percent when buyPrice is 0", () => {
      const result = calculateMaxInvestmentStats(0, 100);

      expect(result.maxProfitPercent).toBe(0);
      expect(result.maxProfitAbsolute).toBe(0);
    });

    it("rounds values to 2 decimal places", () => {
      const result = calculateMaxInvestmentStats(0.333333, 123.456789);

      expect(result.maxInvestment).toBe(123.46);
      expect(result.maxProfitPercent).toBeCloseTo(200, 0); // (1-0.33)/0.33 * 100
    });
  });

  /**
   * ============================================================================
   * PART 4: Address Validation Tests
   * ============================================================================
   */
  describe("Address Validation Functions", () => {
    describe("isValidAddress", () => {
      it("accepts valid Ethereum addresses", () => {
        expect(isValidAddress("0x066A4678935b78FA4E89e914dBE8F077764F0c74")).toBe(true);
        expect(isValidAddress("0x" + "1".repeat(40))).toBe(true);
        expect(isValidAddress("0x" + "a".repeat(40))).toBe(true);
        expect(isValidAddress("0x" + "A".repeat(40))).toBe(true);
        expect(isValidAddress("0x" + "f".repeat(40))).toBe(true);
      });

      it("rejects addresses without 0x prefix", () => {
        expect(isValidAddress("066A4678935b78FA4E89e914dBE8F077764F0c74")).toBe(false);
        expect(isValidAddress("1".repeat(40))).toBe(false);
      });

      it("rejects addresses that are too short", () => {
        expect(isValidAddress("0x" + "1".repeat(38))).toBe(false);
        expect(isValidAddress("0x1234")).toBe(false);
      });

      it("rejects addresses that are too long", () => {
        expect(isValidAddress("0x" + "1".repeat(42))).toBe(false);
        expect(isValidAddress("0x" + "1".repeat(50))).toBe(false);
      });

      it("rejects addresses with invalid characters", () => {
        expect(isValidAddress("0x" + "g".repeat(40))).toBe(false);
        expect(isValidAddress("0x" + "G".repeat(40))).toBe(false);
        expect(isValidAddress("0x" + "!".repeat(40))).toBe(false);
        expect(isValidAddress("0x" + " ".repeat(40))).toBe(false);
      });

      it("rejects empty or null addresses", () => {
        expect(isValidAddress("")).toBe(false);
        expect(isValidAddress(null as any)).toBe(false);
        expect(isValidAddress(undefined as any)).toBe(false);
      });

      it("rejects non-string inputs", () => {
        expect(isValidAddress(123 as any)).toBe(false);
        expect(isValidAddress({} as any)).toBe(false);
        expect(isValidAddress([] as any)).toBe(false);
      });
    });

    describe("isValidPrivateKey", () => {
      it("accepts valid private keys", () => {
        expect(isValidPrivateKey("0x" + "a".repeat(64))).toBe(true);
        expect(isValidPrivateKey("0x" + "1".repeat(64))).toBe(true);
        expect(isValidPrivateKey("0x" + "A".repeat(64))).toBe(true);
        expect(isValidPrivateKey("0x" + "F".repeat(64))).toBe(true);
      });

      it("rejects keys without 0x prefix", () => {
        expect(isValidPrivateKey("a".repeat(64))).toBe(false);
      });

      it("rejects keys that are too short", () => {
        expect(isValidPrivateKey("0x" + "a".repeat(62))).toBe(false);
        expect(isValidPrivateKey("0x1234")).toBe(false);
      });

      it("rejects keys that are too long", () => {
        expect(isValidPrivateKey("0x" + "a".repeat(66))).toBe(false);
      });

      it("rejects keys with invalid characters", () => {
        expect(isValidPrivateKey("0x" + "g".repeat(64))).toBe(false);
        expect(isValidPrivateKey("0x" + " ".repeat(64))).toBe(false);
      });

      it("rejects empty or null keys", () => {
        expect(isValidPrivateKey("")).toBe(false);
        expect(isValidPrivateKey(null as any)).toBe(false);
        expect(isValidPrivateKey(undefined as any)).toBe(false);
      });
    });

    describe("normalizeAddress", () => {
      it("converts addresses to lowercase", () => {
        expect(normalizeAddress("0xABC")).toBe("0xabc");
        expect(normalizeAddress("0x066A4678935b78FA4E89e914dBE8F077764F0c74")).toBe(
          "0x066a4678935b78fa4e89e914dbe8f077764f0c74",
        );
      });

      it("handles already lowercase addresses", () => {
        expect(normalizeAddress("0xabc")).toBe("0xabc");
      });
    });

    describe("addressesEqual", () => {
      it("returns true for identical addresses", () => {
        expect(
          addressesEqual(
            "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
            "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
          ),
        ).toBe(true);
      });

      it("returns true for same addresses with different case", () => {
        expect(
          addressesEqual(
            "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
            "0x066a4678935b78fa4e89e914dbe8f077764f0c74",
          ),
        ).toBe(true);
      });

      it("returns false for different addresses", () => {
        expect(
          addressesEqual(
            "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
            "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525",
          ),
        ).toBe(false);
      });
    });

    describe("isValidSignatureType", () => {
      it("accepts valid signature types", () => {
        expect(isValidSignatureType(0)).toBe(true); // EOA
        expect(isValidSignatureType(1)).toBe(true); // Proxy
        expect(isValidSignatureType(2)).toBe(true); // Safe
      });

      it("rejects invalid signature types", () => {
        expect(isValidSignatureType(3)).toBe(false);
        expect(isValidSignatureType(-1)).toBe(false);
        expect(isValidSignatureType(100)).toBe(false);
      });
    });
  });

  /**
   * ============================================================================
   * PART 5: Mock On-Chain Response Tests
   * ============================================================================
   */
  describe("Mock On-Chain Response Handling", () => {
    describe("Order book response parsing", () => {
      it("handles typical CLOB order book response format", () => {
        // Simulates actual response from Polymarket CLOB
        const clobResponse = [
          { price: "0.85000000", size: "1000.00000000" },
          { price: "0.86000000", size: "500.00000000" },
          { price: "0.87000000", size: "2000.00000000" },
        ];

        const parsed = parseOrderBookEntries(clobResponse);

        expect(parsed).toHaveLength(3);
        expect(parsed[0]).toEqual({ price: 0.85, size: 1000 });
        expect(parsed[1]).toEqual({ price: 0.86, size: 500 });
        expect(parsed[2]).toEqual({ price: 0.87, size: 2000 });
      });

      it("handles order book with varying decimal precision", () => {
        const clobResponse = [
          { price: "0.9", size: "100" },
          { price: "0.95", size: "50.5" },
          { price: "0.951", size: "25.25" },
          { price: "0.9512", size: "10.125" },
        ];

        const parsed = parseOrderBookEntries(clobResponse);

        expect(parsed).toHaveLength(4);
        expect(parsed[0]!.price).toBe(0.9);
        expect(parsed[3]!.price).toBe(0.9512);
      });

      it("handles empty or null entries gracefully", () => {
        const clobResponse: any[] = [
          { price: "0.95", size: "100" },
          null,
          undefined,
          { price: "0.96", size: "200" },
        ];

        // Should not throw, but may produce unexpected results
        expect(() => parseOrderBookEntries(clobResponse.filter(Boolean))).not.toThrow();
      });
    });

    describe("Effective price calculation with realistic scenarios", () => {
      it("handles thin order book (low liquidity)", () => {
        const asks: OrderBookLevel[] = [
          { price: 0.9, size: 5 }, // Only $4.50
        ];

        const result = calculateEffectivePrice(asks, 100);

        expect(result.canFill).toBe(false);
        expect(result.tokensReceived).toBe(5);
      });

      it("handles deep order book (high liquidity)", () => {
        const asks: OrderBookLevel[] = [
          { price: 0.9, size: 10000 },
          { price: 0.91, size: 10000 },
          { price: 0.92, size: 10000 },
        ];

        const result = calculateEffectivePrice(asks, 5000);

        expect(result.canFill).toBe(true);
        // Should fill entirely at 0.90
        expect(result.effectivePrice).toBe(0.9);
      });

      it("handles price slippage across levels", () => {
        const asks: OrderBookLevel[] = [
          { price: 0.9, size: 500 }, // $450
          { price: 0.95, size: 500 }, // $475
          { price: 1.0, size: 500 }, // $500
        ];

        // Try to spend $1000
        const result = calculateEffectivePrice(asks, 1000);

        expect(result.canFill).toBe(true);
        // Spends $450 at 0.90, $475 at 0.95, $75 at 1.00
        // Total tokens: 500 + 500 + 75 = 1075
        // Effective price: 1000 / 1075 ≈ 0.93
        expect(result.effectivePrice).toBeGreaterThan(0.9);
        expect(result.effectivePrice).toBeLessThan(0.95);
      });
    });
  });

  /**
   * ============================================================================
   * PART 6: Integration Tests - Combined Parser + Guardrail Flow
   * ============================================================================
   */
  describe("Integration: Parser + Guardrail Flow", () => {
    describe("Integration: Parser + Guardrail Flow", () => {
      it("end-to-end: parse order book and validate opportunity", () => {
        // Step 1: Parse raw order book data
        const rawOrderBook = [
          { price: "0.92000000", size: "500.00000000" },
          { price: "0.93000000", size: "1000.00000000" },
          { price: "0.94000000", size: "2000.00000000" },
        ];
        const asks = parseOrderBookEntries(rawOrderBook);
        expect(asks).toHaveLength(3);

        // Step 2: Check effective price for $100 bet
        const priceCheck = checkEffectivePrice(asks, 100, 0.99);
        expect(priceCheck.acceptable).toBe(true);
        expect(priceCheck.effectivePrice).toBeLessThan(0.99);

        // Step 3: Validate opportunity with strategy rules
        const config = createBaseConfig();
        const validation = isValidOpportunity(
          priceCheck.effectivePrice,
          12, // resolves in 12 hours
          config,
        );
        expect(validation.valid).toBe(true);

        // Step 4: Calculate PPH
        const pph = calculatePPH(priceCheck.effectivePrice, 12);
        expect(pph).toBeGreaterThan(0);

        // Step 5: Calculate expected profit
        const profit = calculateExpectedProfit(priceCheck.effectivePrice);
        expect(profit).toBeGreaterThan(0);
      });

      it("rejects opportunity when price check fails", () => {
        const rawOrderBook = [{ price: "0.99500000", size: "1000.00000000" }];
        const asks = parseOrderBookEntries(rawOrderBook);

        const priceCheck = checkEffectivePrice(asks, 100, 0.99);
        expect(priceCheck.acceptable).toBe(false);

        // Even if opportunity validation passes, price check should block it
        const config = createBaseConfig();
        const validation = isValidOpportunity(0.995, 12, config);
        expect(validation.valid).toBe(false); // Above maxOdds
      });
    });
  });
});

/**
 * ============================================================================
 * PART 6: Integration Tests - Combined Parser + Guardrail Flow
 * ============================================================================
 */
describe("Integration: Parser + Guardrail Flow", () => {
  it("end-to-end: parse order book and validate opportunity", () => {
    // Step 1: Parse raw order book data
    const rawOrderBook = [
      { price: "0.92000000", size: "500.00000000" },
      { price: "0.93000000", size: "1000.00000000" },
      { price: "0.94000000", size: "2000.00000000" },
    ];
    const asks = parseOrderBookEntries(rawOrderBook);
    expect(asks).toHaveLength(3);

    // Step 2: Check effective price for $100 bet
    const priceCheck = checkEffectivePrice(asks, 100, 0.99);
    expect(priceCheck.acceptable).toBe(true);
    expect(priceCheck.effectivePrice).toBeLessThan(0.99);

    // Step 3: Validate opportunity with strategy rules
    const config = createBaseConfig();
    const validation = isValidOpportunity(
      priceCheck.effectivePrice,
      12, // resolves in 12 hours
      config,
    );
    expect(validation.valid).toBe(true);

    // Step 4: Calculate PPH
    const pph = calculatePPH(priceCheck.effectivePrice, 12);
    expect(pph).toBeGreaterThan(0);

    // Step 5: Calculate expected profit
    const profit = calculateExpectedProfit(priceCheck.effectivePrice);
    expect(profit).toBeGreaterThan(0);
  });

  it("rejects opportunity when price check fails", () => {
    const rawOrderBook = [{ price: "0.99500000", size: "1000.00000000" }];
    const asks = parseOrderBookEntries(rawOrderBook);

    const priceCheck = checkEffectivePrice(asks, 100, 0.99);
    expect(priceCheck.acceptable).toBe(false);

    // Even if opportunity validation passes, price check should block it
    const config = createBaseConfig();
    const validation = isValidOpportunity(0.995, 12, config);
    expect(validation.valid).toBe(false); // Above maxOdds
  });
});
