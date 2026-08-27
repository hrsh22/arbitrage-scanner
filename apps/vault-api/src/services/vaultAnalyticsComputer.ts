import type { VaultResolvedAnalyticsPosition } from "../db/schema.js";

const THRESHOLDS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90];
const ENTRY_TIMING_HOURS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24];

interface StopLossSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  recoveredAfterTrigger: boolean;
  profitLossIfSold: number | null;
  profitLossIfHeld: number;
}

interface HedgingStrategy {
  name: string;
  triggerPrice: number;
  oppositePrice: number;
  oppSharesBought: number;
  costToBuy: number;
  expectedPnl: number;
  actualPnl: number | null;
}

interface HedgingSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  strategies: HedgingStrategy[];
}

export interface StopLossAnalysisItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  totalPnlIfSold: number;
  totalPnlIfHeld: number;
  netImpact: number;
  avgImpactPerTriggered: number;
}

export interface HedgingAnalysisItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  fullLockGrossSavings: number;
  fullLockCostOnWinners: number;
  fullLockNetImpact: number;
  doubleOppositeGrossSavings: number;
  doubleOppositeCostOnWinners: number;
  doubleOppositeNetImpact: number;
}

interface CategoryStopLossItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  netImpact: number;
}

interface CategoryHedgingItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  fullLockGrossSavings: number;
  fullLockCostOnWinners: number;
  fullLockNetImpact: number;
  doubleOppositeGrossSavings: number;
  doubleOppositeCostOnWinners: number;
  doubleOppositeNetImpact: number;
}

interface BestStrategy {
  type: "stop-loss" | "hedge-full" | "hedge-double" | "none";
  threshold: number | null;
  expectedImprovement: number;
  reason: string;
}

export interface CategoryBreakdownItem {
  category: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgDrawdown: number;
  stopLossAnalysis: CategoryStopLossItem[];
  hedgingAnalysis: CategoryHedgingItem[];
  bestStrategy: BestStrategy;
}

interface DailyPnlItem {
  date: string;
  pnl: number;
  positionCount: number;
  cumulativePnl: number;
}

export interface EntryTimingItem {
  hoursBeforeResolution: number;
  positionsEligible: number;
  positionsWon: number;
  positionsLost: number;
  winRate: number;
  avgEntryPrice: number;
}

export interface ComputedAnalytics {
  totalPnl: string;
  totalCost: string;
  winCount: string;
  lossCount: string;
  winRate: string;
  avgEntryPrice: string;
  avgPnlPerPosition: string;
  avgHoldingHours: string;
  stopLossAnalysis: StopLossAnalysisItem[];
  hedgingAnalysis: HedgingAnalysisItem[];
  categoryBreakdown: CategoryBreakdownItem[];
  dailyPnl: DailyPnlItem[];
  entryTimingAnalysis: EntryTimingItem[];
  positionCount: number;
}

export function computeVaultAnalytics(
  positions: VaultResolvedAnalyticsPosition[],
): ComputedAnalytics {
  if (positions.length === 0) {
    return {
      totalPnl: "0",
      totalCost: "0",
      winCount: "0",
      lossCount: "0",
      winRate: "0",
      avgEntryPrice: "0",
      avgPnlPerPosition: "0",
      avgHoldingHours: "0",
      stopLossAnalysis: [],
      hedgingAnalysis: [],
      categoryBreakdown: [],
      dailyPnl: [],
      entryTimingAnalysis: [],
      positionCount: 0,
    };
  }

  const wins = positions.filter((p) => p.result === "won");
  const losses = positions.filter((p) => p.result === "lost");

  const totalPnl = positions.reduce((sum, p) => sum + parseFloat(p.profitLoss || "0"), 0);
  const totalCost = positions.reduce((sum, p) => sum + parseFloat(p.cost || "0"), 0);
  const totalCount = positions.length;
  const winRate = totalCount > 0 ? wins.length / totalCount : 0;

  const avgEntryPrice =
    positions.reduce((sum, p) => sum + parseFloat(p.entryPrice || "0"), 0) / totalCount;
  const avgPnlPerPosition = totalPnl / totalCount;

  let totalHoldingHours = 0;
  for (const p of positions) {
    if (p.createdAt && p.marketEndDate) {
      const hours =
        (new Date(p.marketEndDate).getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60);
      totalHoldingHours += Math.max(0, hours);
    }
  }
  const avgHoldingHours = totalHoldingHours / totalCount;

  const stopLossAnalysis: StopLossAnalysisItem[] = THRESHOLDS.map((threshold) => {
    let triggeredCount = 0;
    let recoveredCount = 0;
    let totalPnlIfSold = 0;
    let totalPnlIfHeld = 0;

    for (const p of positions) {
      const sims = p.stopLossSimulations as StopLossSimulation[] | null;
      if (!sims) continue;
      const sim = sims.find((s) => s.threshold === threshold);
      if (sim?.triggered) {
        triggeredCount++;
        if (sim.recoveredAfterTrigger) recoveredCount++;
        if (sim.profitLossIfSold !== null) totalPnlIfSold += sim.profitLossIfSold;
        totalPnlIfHeld += sim.profitLossIfHeld;
      }
    }

    const netImpact = totalPnlIfSold - totalPnlIfHeld;
    return {
      threshold,
      triggeredCount,
      recoveredCount,
      totalPnlIfSold,
      totalPnlIfHeld,
      netImpact,
      avgImpactPerTriggered: triggeredCount > 0 ? netImpact / triggeredCount : 0,
    };
  });

  const hedgingAnalysis: HedgingAnalysisItem[] = THRESHOLDS.map((threshold) => {
    let triggeredCount = 0;
    let recoveredCount = 0;
    let fullLockGrossSavings = 0;
    let fullLockCostOnWinners = 0;
    let doubleOppositeGrossSavings = 0;
    let doubleOppositeCostOnWinners = 0;

    for (const p of positions) {
      const sims = p.hedgingSimulations as HedgingSimulation[] | null;
      if (!sims) continue;
      const sim = sims.find((s) => s.threshold === threshold);
      if (sim?.triggered && sim.strategies.length > 0) {
        triggeredCount++;
        const isWinner = p.result === "won";
        if (isWinner) recoveredCount++;
        const actualPnL = parseFloat(p.profitLoss || "0");

        for (const strat of sim.strategies) {
          if (strat.actualPnl !== null) {
            const impact = strat.actualPnl - actualPnL;
            if (strat.name === "fullLockIn") {
              if (impact > 0) {
                fullLockGrossSavings += impact;
              } else {
                fullLockCostOnWinners += Math.abs(impact);
              }
            } else if (strat.name === "doubleOpposite") {
              if (impact > 0) {
                doubleOppositeGrossSavings += impact;
              } else {
                doubleOppositeCostOnWinners += Math.abs(impact);
              }
            }
          }
        }
      }
    }

    return {
      threshold,
      triggeredCount,
      recoveredCount,
      fullLockGrossSavings,
      fullLockCostOnWinners,
      fullLockNetImpact: fullLockGrossSavings - fullLockCostOnWinners,
      doubleOppositeGrossSavings,
      doubleOppositeCostOnWinners,
      doubleOppositeNetImpact: doubleOppositeGrossSavings - doubleOppositeCostOnWinners,
    };
  });

  const categoryMap = new Map<string, VaultResolvedAnalyticsPosition[]>();
  for (const p of positions) {
    const cat = p.category || "Unknown";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(p);
  }

  const categoryBreakdown: CategoryBreakdownItem[] = [];
  for (const [category, catPositions] of categoryMap) {
    const catWins = catPositions.filter((p) => p.result === "won").length;
    const catLosses = catPositions.filter((p) => p.result === "lost").length;
    const catTotal = catPositions.length;
    const catPnl = catPositions.reduce((sum, p) => sum + parseFloat(p.profitLoss || "0"), 0);
    const catDrawdown =
      catPositions.reduce((sum, p) => sum + parseFloat(p.maxDrawdownPercent || "0"), 0) / catTotal;

    const catStopLossAnalysis: CategoryStopLossItem[] = THRESHOLDS.map((threshold) => {
      let triggeredCount = 0;
      let recoveredCount = 0;
      let netImpact = 0;

      for (const pos of catPositions) {
        const sims = pos.stopLossSimulations as StopLossSimulation[] | null;
        if (!sims) continue;
        const sim = sims.find((s) => s.threshold === threshold);
        if (sim && sim.triggered) {
          triggeredCount++;
          if (sim.recoveredAfterTrigger) recoveredCount++;
          const pnlIfSold = sim.profitLossIfSold ?? 0;
          netImpact += pnlIfSold - sim.profitLossIfHeld;
        }
      }

      return { threshold, triggeredCount, recoveredCount, netImpact };
    });

    const catHedgingAnalysis: CategoryHedgingItem[] = THRESHOLDS.map((threshold) => {
      let triggeredCount = 0;
      let recoveredCount = 0;
      let fullLockGrossSavings = 0;
      let fullLockCostOnWinners = 0;
      let doubleOppositeGrossSavings = 0;
      let doubleOppositeCostOnWinners = 0;

      for (const pos of catPositions) {
        const sims = pos.hedgingSimulations as HedgingSimulation[] | null;
        if (!sims) continue;
        const sim = sims.find((s) => s.threshold === threshold);
        if (sim && sim.triggered && sim.strategies) {
          triggeredCount++;
          const isWinner = pos.result === "won";
          if (isWinner) recoveredCount++;

          const actualPnL = parseFloat(pos.profitLoss || "0");
          const fullLock = sim.strategies.find((st) => st.name === "fullLockIn");
          const doubleOpp = sim.strategies.find((st) => st.name === "doubleOpposite");

          if (fullLock && fullLock.actualPnl !== null) {
            const impact = fullLock.actualPnl - actualPnL;
            if (impact > 0) {
              fullLockGrossSavings += impact;
            } else {
              fullLockCostOnWinners += Math.abs(impact);
            }
          }
          if (doubleOpp && doubleOpp.actualPnl !== null) {
            const impact = doubleOpp.actualPnl - actualPnL;
            if (impact > 0) {
              doubleOppositeGrossSavings += impact;
            } else {
              doubleOppositeCostOnWinners += Math.abs(impact);
            }
          }
        }
      }

      return {
        threshold,
        triggeredCount,
        recoveredCount,
        fullLockGrossSavings,
        fullLockCostOnWinners,
        fullLockNetImpact: fullLockGrossSavings - fullLockCostOnWinners,
        doubleOppositeGrossSavings,
        doubleOppositeCostOnWinners,
        doubleOppositeNetImpact: doubleOppositeGrossSavings - doubleOppositeCostOnWinners,
      };
    });

    let bestStopLoss = { threshold: 0, netImpact: -Infinity };
    for (const sl of catStopLossAnalysis) {
      if (sl.netImpact > bestStopLoss.netImpact) {
        bestStopLoss = { threshold: sl.threshold, netImpact: sl.netImpact };
      }
    }

    let bestHedgeFull = { threshold: 0, netImpact: -Infinity };
    let bestHedgeDouble = { threshold: 0, netImpact: -Infinity };
    for (const h of catHedgingAnalysis) {
      if (h.fullLockNetImpact > bestHedgeFull.netImpact) {
        bestHedgeFull = { threshold: h.threshold, netImpact: h.fullLockNetImpact };
      }
      if (h.doubleOppositeNetImpact > bestHedgeDouble.netImpact) {
        bestHedgeDouble = { threshold: h.threshold, netImpact: h.doubleOppositeNetImpact };
      }
    }

    let bestStrategy: BestStrategy;
    const improvements = [
      {
        type: "stop-loss" as const,
        threshold: bestStopLoss.threshold,
        improvement: bestStopLoss.netImpact,
      },
      {
        type: "hedge-full" as const,
        threshold: bestHedgeFull.threshold,
        improvement: bestHedgeFull.netImpact,
      },
      {
        type: "hedge-double" as const,
        threshold: bestHedgeDouble.threshold,
        improvement: bestHedgeDouble.netImpact,
      },
    ];

    const best = improvements.reduce((a, b) => (b.improvement > a.improvement ? b : a));

    if (best.improvement <= 0) {
      bestStrategy = {
        type: "none",
        threshold: null,
        expectedImprovement: 0,
        reason: "No strategy improves P/L for this category",
      };
    } else {
      const strategyNames = {
        "stop-loss": "Stop-Loss",
        "hedge-full": "Full Hedge",
        "hedge-double": "2x Hedge",
      };
      bestStrategy = {
        type: best.type,
        threshold: best.threshold,
        expectedImprovement: best.improvement,
        reason: `${strategyNames[best.type]} at ${best.threshold}% → net +$${best.improvement.toFixed(2)}`,
      };
    }

    categoryBreakdown.push({
      category,
      positionCount: catTotal,
      winCount: catWins,
      lossCount: catLosses,
      winRate: catTotal > 0 ? catWins / catTotal : 0,
      totalPnl: catPnl,
      avgPnl: catPnl / catTotal,
      avgDrawdown: catDrawdown,
      stopLossAnalysis: catStopLossAnalysis,
      hedgingAnalysis: catHedgingAnalysis,
      bestStrategy,
    });
  }
  categoryBreakdown.sort((a, b) => b.positionCount - a.positionCount);

  const dailyMap = new Map<string, { pnl: number; count: number }>();
  for (const p of positions) {
    if (!p.marketEndDate) continue;
    const date = new Date(p.marketEndDate).toISOString().split("T")[0]!;
    const existing = dailyMap.get(date) || { pnl: 0, count: 0 };
    existing.pnl += parseFloat(p.profitLoss || "0");
    existing.count++;
    dailyMap.set(date, existing);
  }

  const sortedDates = Array.from(dailyMap.keys()).sort();
  let cumulativePnl = 0;
  const dailyPnl: DailyPnlItem[] = sortedDates.map((date) => {
    const data = dailyMap.get(date)!;
    cumulativePnl += data.pnl;
    return {
      date,
      pnl: data.pnl,
      positionCount: data.count,
      cumulativePnl,
    };
  });

  const entryTimingAnalysis: EntryTimingItem[] = ENTRY_TIMING_HOURS.map((hours) => {
    let eligible = 0;
    let won = 0;
    let lost = 0;
    let totalEntryPrice = 0;

    for (const pos of positions) {
      if (!pos.priceHistory || !pos.marketEndDate) continue;

      const history = pos.priceHistory as { timestamp: number; price: number }[];
      if (history.length === 0) continue;

      const marketEndTs = Math.floor(new Date(pos.marketEndDate).getTime() / 1000);
      const windowStart = marketEndTs - hours * 3600;
      const windowEnd = marketEndTs;

      let wasEnterable = false;

      for (const point of history) {
        if (point.timestamp >= windowStart && point.timestamp <= windowEnd) {
          if (point.price >= 0.95 && point.price < 0.995) {
            wasEnterable = true;
            break;
          }
        }
      }

      if (wasEnterable) {
        eligible++;
        totalEntryPrice += parseFloat(pos.entryPrice || "0");
        if (pos.result === "won") {
          won++;
        } else {
          lost++;
        }
      }
    }

    return {
      hoursBeforeResolution: hours,
      positionsEligible: eligible,
      positionsWon: won,
      positionsLost: lost,
      winRate: eligible > 0 ? won / eligible : 0,
      avgEntryPrice: eligible > 0 ? totalEntryPrice / eligible : 0,
    };
  });

  return {
    totalPnl: totalPnl.toFixed(4),
    totalCost: totalCost.toFixed(4),
    winCount: wins.length.toString(),
    lossCount: losses.length.toString(),
    winRate: winRate.toFixed(4),
    avgEntryPrice: avgEntryPrice.toFixed(6),
    avgPnlPerPosition: avgPnlPerPosition.toFixed(4),
    avgHoldingHours: avgHoldingHours.toFixed(2),
    stopLossAnalysis,
    hedgingAnalysis,
    categoryBreakdown,
    dailyPnl,
    entryTimingAnalysis,
    positionCount: positions.length,
  };
}
