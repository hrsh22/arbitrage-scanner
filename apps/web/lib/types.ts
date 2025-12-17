export type OpportunityType = "arbitrage" | "near-resolution"

export type OutcomePrice = {
  name: string
  askPrice: number
  liquidity: number
}

export type Opportunity = {
  key: string
  type: OpportunityType
  question: string
  marketId: string
  marketSlug?: string | null
  eventId?: string | null
  eventSlug?: string | null
  eventTitle?: string | null
  marketUrl?: string | null
  outcomes: OutcomePrice[]
  totalCost: number         // Cost to buy both Yes and No
  profitAbsolute: number    // Guaranteed profit = $1 - totalCost
  profitPercentage: number  // (profitAbsolute / totalCost) * 100
  availableLiquidity: number
  score: number
  closesAt?: string | null
  detectedAt: string
  expiredAt?: string | null
  isActive?: boolean
}

// Near-resolution high-confidence opportunity
export type NearResolutionOpportunity = {
  key: string
  type: "near-resolution"
  marketId: string
  marketSlug?: string | null
  eventId?: string | null
  eventSlug?: string | null
  eventTitle?: string | null
  question: string
  marketUrl?: string | null

  likelyOutcome: {
    name: string
    probability: number
    bestBid: number
    bestAsk: number
    liquidity: number
  }

  closesAt: string
  hoursUntilClose: number

  potentialProfit: number
  potentialLoss: number
  expectedValue: number

  score: number
  detectedAt: string
}

export type OpportunityFilter = {
  minProfitPct: number
  minLiquidity: number
  sort: "score" | "profit" | "liquidity" | "newest"
}

export type NearResolutionFilter = {
  maxHours: number          // Hours until close (default: 24)
  minOdds: number           // Min cents (default: 95)
  sort: "time" | "odds"     // Default: "time"
}

export type OpportunitiesResponse = {
  opportunities: Opportunity[]
  enabled?: boolean
  message?: string
  lastUpdated?: string | null
}

export type NearResolutionResponse = {
  opportunities: NearResolutionOpportunity[]
  total: number
  filters: {
    maxHours: number
    minOdds: number
    sort: string
  }
  lastUpdated: string
}

export type HistoryResponse = {
  opportunities: Opportunity[]
  total: number
  active: number
  expired: number
}

export type OpportunityStats = {
  opportunities: {
    total: number
    active: number
    expired: number
    potentialProfit: number
  }
  actions: {
    executed: number
    missed: number
    actualProfit: number
  }
}

// Cross-platform arbitrage opportunity (Polymarket <> Kalshi)
export type CrossPlatformOpportunity = {
  id: string
  matchConfidence: number
  matchReason: string
  matchType: "high" | "medium" | "low"

  polymarket: {
    id: string
    question: string
    url: string
    yesBestAsk: number
    noBestAsk: number
  }

  kalshi: {
    ticker: string
    title: string
    url: string
    yesAsk: number
    noAsk: number
  }

  arbitrage: {
    type: "poly-yes-kalshi-no" | "poly-no-kalshi-yes" | "none"
    totalCost: number
    profit: number
    profitPct: number
    instruction: string
  }

  detectedAt: string
}

export type CrossPlatformResponse = {
  opportunities: CrossPlatformOpportunity[]
  total: number
  withArbitrage: number
  lastUpdated: string
}
