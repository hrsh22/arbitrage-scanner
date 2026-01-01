/**
 * Trading Bot - Public Exports
 *
 * Multi-bot architecture supporting multiple configurations and wallets.
 */

// Configuration
export {
  BOT_CONFIG,
  BOT_CONFIGS,
  DEFAULT_BOT_CONFIG,
  getBotConfig,
  getEnabledBotConfigs,
  getBotConfigByName,
  type BotMode,
  type BotConfig,
  type BotInstanceConfig,
} from "./config.js";

// Bot Manager (primary interface for multi-bot operations)
export { getBotManager, BotManager } from "./botManager.js";

// Individual bot components
export { getTradingBot, getTradingBotById, TradingBot, clearBotInstances } from "./tradingBot.js";
export { getTradingClient, TradingClient } from "./tradingClient.js";
export { StrategyEngine, calculatePPH, isValidOpportunity } from "./strategyEngine.js";
export { getBotRepository, BotRepository } from "./repository.js";
export {
  getResolutionChecker,
  getResolutionCheckerById,
  ResolutionChecker,
} from "./resolutionChecker.js";

// API routes
export { buildBotRouter } from "./routes.js";

// Types
export * from "./types.js";
