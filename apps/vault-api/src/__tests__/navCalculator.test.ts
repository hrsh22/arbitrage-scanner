import { describe, it, expect, vi, beforeEach } from "vitest";
import { NavCalculator } from "../services/navCalculator.js";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({ vaultNavHistory: {} }));

describe("NavCalculator", () => {
  let calculator: NavCalculator;

  beforeEach(() => {
    calculator = new NavCalculator({} as any);
  });

  describe("calculateNav", () => {
    it("calculates NAV with idle + deployed market value", () => {
      const nav = calculator.calculateNav(150, 55, 50, 1.025, 3);

      expect(nav.deployedMarketValue).toBe(55);
      expect(nav.deployedCostBasis).toBe(50);
      expect(nav.idleAssets).toBe(150);
      expect(nav.totalAssets).toBe(205);
      expect(nav.sharePrice).toBe(1.025);
      expect(nav.positionCount).toBe(3);
      expect(nav.lastUpdated).toBeInstanceOf(Date);
    });

    it("returns idle-only NAV when no positions are open", () => {
      const nav = calculator.calculateNav(100, 0, 0, 1.0, 0);

      expect(nav.deployedCostBasis).toBe(0);
      expect(nav.deployedMarketValue).toBe(0);
      expect(nav.idleAssets).toBe(100);
      expect(nav.totalAssets).toBe(100);
      expect(nav.positionCount).toBe(0);
    });

    it("handles zero idle with deployed positions", () => {
      const nav = calculator.calculateNav(0, 30, 25, 0.95, 2);

      expect(nav.deployedCostBasis).toBe(25);
      expect(nav.deployedMarketValue).toBe(30);
      expect(nav.idleAssets).toBe(0);
      expect(nav.totalAssets).toBe(30);
      expect(nav.positionCount).toBe(2);
    });

    it("handles fractional values", () => {
      const nav = calculator.calculateNav(0.75, 1.25, 1.0, 1.0, 2);

      expect(nav.deployedCostBasis).toBe(1.0);
      expect(nav.deployedMarketValue).toBe(1.25);
      expect(nav.idleAssets).toBe(0.75);
      expect(nav.totalAssets).toBe(2.0);
    });

    it("uses provided share price directly", () => {
      const nav = calculator.calculateNav(100, 50, 50, 1.5, 1);
      expect(nav.sharePrice).toBe(1.5);
    });
  });

  describe("getSharePrice", () => {
    it("returns 1.0 when total shares is zero", () => {
      expect(calculator.getSharePrice(1000, 0)).toBe(1.0);
    });

    it("calculates share price correctly", () => {
      expect(calculator.getSharePrice(1000, 500)).toBe(2);
    });

    it("calculates sub-1.0 share price for loss scenario", () => {
      expect(calculator.getSharePrice(750, 1000)).toBe(0.75);
    });

    it("handles very small share price", () => {
      const price = calculator.getSharePrice(1, 1_000_000);
      expect(price).toBeCloseTo(0.000001, 6);
    });
  });
});
