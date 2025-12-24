import type { Opportunity, OpportunityFilter } from "../types.js";

const sortOpportunities = (items: Opportunity[], sort?: OpportunityFilter["sort"]) => {
  switch (sort) {
    case "profit":
      return items.sort((a, b) => b.profitPercentage - a.profitPercentage);
    case "liquidity":
      return items.sort((a, b) => b.availableLiquidity - a.availableLiquidity);
    case "newest":
      return items.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    case "score":
    default:
      return items.sort((a, b) => b.score - a.score);
  }
};

export class OpportunityStore {
  private opportunities = new Map<string, Opportunity>();
  private lastUpdated: Date | null = null;

  update(list: Opportunity[]) {
    // Clear old opportunities and replace with new ones
    this.opportunities.clear();
    for (const opportunity of list) {
      this.opportunities.set(opportunity.key, opportunity);
    }
    this.lastUpdated = new Date();
  }

  all(filter?: OpportunityFilter): Opportunity[] {
    const items = Array.from(this.opportunities.values()).filter((opportunity) => {
      if (
        filter?.minProfitPct !== undefined &&
        opportunity.profitPercentage < filter.minProfitPct
      ) {
        return false;
      }
      if (
        filter?.minLiquidity !== undefined &&
        opportunity.availableLiquidity < filter.minLiquidity
      ) {
        return false;
      }
      return true;
    });

    return sortOpportunities(items, filter?.sort ?? "score");
  }

  getLastUpdated() {
    return this.lastUpdated;
  }
}
