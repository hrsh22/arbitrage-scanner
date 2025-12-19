export type OpportunityType = "arbitrage" | "near-resolution"

export type NormalizedOutcome = {
  id: string
  name: string
  midPrice: number | null     // From Gamma API (used for probability estimate)
  bestBid: number | null      // From CLOB (what you'd get if selling)
  bestAsk: number | null      // From CLOB (what you'd pay to buy)
  availableLiquidity: number
}

export type NormalizedMarket = {
  id: string
  question: string
  description?: string  // Resolution rules
  slug?: string
  status: string
  eventId?: string
  eventSlug?: string
  eventTitle?: string
  eventStartDate?: Date | null
  eventEndDate?: Date | null
  endsAt?: Date | null
  outcomes: NormalizedOutcome[]
  liquidity?: number   // Market-level liquidity from Gamma API
  volume?: number      // Market-level volume from Gamma API
  _tokenIds?: string[]  // Internal: used for order book enrichment
}

export type OutcomePrice = {
  name: string
  askPrice: number
  liquidity: number
}

export type Opportunity = {
  key: string
  type: OpportunityType
  marketId: string
  marketSlug?: string
  eventId?: string
  eventSlug?: string
  eventTitle?: string
  question: string
  outcomes: OutcomePrice[]
  totalCost: number         // Cost to buy both Yes and No
  profitAbsolute: number    // Guaranteed profit = $1 - totalCost
  profitPercentage: number  // profitAbsolute / totalCost * 100
  availableLiquidity: number
  score: number
  closesAt?: Date | null
  detectedAt: Date
}

// Near-resolution high-confidence opportunity
export type NearResolutionOpportunity = {
  key: string
  type: "near-resolution"
  marketId: string
  marketSlug?: string
  eventId?: string
  eventSlug?: string
  eventTitle?: string
  question: string

  // The likely outcome (Yes or No with highest odds)
  likelyOutcome: {
    name: string
    probability: number     // 0.95 = 95% chance
    bestBid: number         // Price you can sell at
    bestAsk: number         // Price you need to buy at
    liquidity: number
  }

  // Time until resolution
  closesAt: Date
  hoursUntilClose: number

  // Potential profit if correct
  potentialProfit: number   // $1 - ask price (if you win)
  potentialLoss: number     // ask price (if you lose)
  expectedValue: number     // probability * profit - (1-probability) * loss

  score: number             // Ranking score
  detectedAt: Date
}

export type OpportunityFilter = {
  minProfitPct?: number
  minLiquidity?: number
  sort?: "score" | "profit" | "liquidity" | "newest"
}

export type NearResolutionFilter = {
  maxHoursUntilClose?: number  // Default: 24 hours
  minOdds?: number             // Default: 95 (cents), range 0-100
  sort?: "time" | "odds"       // Default: "time" (closest first)
}
