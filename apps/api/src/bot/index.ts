/**
 * Trading Bot - Public Exports
 */

export { BOT_CONFIG, type BotMode, type BotConfig } from "./config.js";
export { getTradingBot, TradingBot } from "./tradingBot.js";
export { getTradingClient, TradingClient } from "./tradingClient.js";
export { StrategyEngine, calculatePPH, isValidOpportunity } from "./strategyEngine.js";
export { getBotRepository, BotRepository } from "./repository.js";
export { getResolutionChecker, ResolutionChecker } from "./resolutionChecker.js";
export { buildBotRouter } from "./routes.js";
export * from "./types.js";
