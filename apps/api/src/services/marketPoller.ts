import { config } from "../config.js"
import { logger } from "../logger.js"
import { env } from "../env.js"
import type { OpportunityStore } from "./opportunityStore.js"
import { runDetectors } from "./detectors.js"
import { PolymarketClient } from "../clients/polymarketClient.js"
import { OpportunityRepository } from "../db/repositories/opportunityRepository.js"

export class MarketPoller {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly client: PolymarketClient,
    private readonly store: OpportunityStore,
    private readonly repository: OpportunityRepository,
  ) { }

  async start() {
    // Skip polling if Polymarket arbitrage is disabled
    if (!env.ENABLE_POLYMARKET_ARBITRAGE) {
      logger.info("Polymarket arbitrage polling disabled via ENABLE_POLYMARKET_ARBITRAGE=false")
      return
    }

    if (this.running) return
    this.running = true
    await this.runCycle()
    this.timer = setInterval(() => {
      void this.runCycle()
    }, config.pollIntervalMs)
  }

  async stop() {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async runCycle() {
    try {
      // Fetch top 500 events with parallel batching (5 batches of 100)
      const markets = await this.client.getNormalizedMarkets()
      const { opportunities } = await runDetectors(markets)

      this.store.update(opportunities)
      await this.repository.persistSnapshot(markets, opportunities)

      logger.info("poll cycle complete", {
        markets: markets.length,
        opportunities: opportunities.length,
      })
    } catch (error) {
      logger.error("poll cycle failed", { error: (error as Error).message })
    }
  }
}
