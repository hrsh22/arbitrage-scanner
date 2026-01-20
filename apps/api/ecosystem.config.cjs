/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Commands:
 *   pm2 list                        - View all processes
 *   pm2 logs                        - View all logs
 *   pm2 logs arbitrage-scanner-node - View API logs
 *   pm2 logs trading-bot-scan       - View trading bot logs
 *   pm2 restart all                 - Restart everything
 *   pm2 stop all                    - Stop everything
 *
 * Cron Schedule:
 *   - Trading bot scan: Every 5 minutes at :00,:05,:10... (fetches markets once, runs all bots in parallel)
 *   - Resolution check: Every 10 minutes at :02,:12,:22... (checks all bot positions for resolution)
 *   - Hedging check: Every 5 minutes at :03,:08,:13... (checks positions for hedging opportunities)
 *   - Resolved positions sync: Every 10 minutes at :07,:17,:27... (syncs resolved positions to DB for analytics)
 */

module.exports = {
  apps: [
    // Main API Server
    {
      name: "polymarket-api",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },

    // Trading Bot Scan - runs ALL bots with shared market data
    // Fetches markets once, then runs all bot instances in parallel
    {
      name: "trading-bot-scan",
      script: "pnpm",
      args: "cron:run-trading-bot",
      cron_restart: "*/5 * * * *",
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
    },

    // Resolution Checker - checks ALL bot positions for resolution
    // Each bot's positions are checked independently
    {
      name: "resolution-checker",
      script: "pnpm",
      args: "cron:check-bot-resolutions",
      cron_restart: "2-59/10 * * * *",
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
    },

    // Hedging Checker - checks positions for hedging when value drops significantly
    // Runs every 5 minutes, offset from trading bot scan
    {
      name: "hedging-checker",
      script: "pnpm",
      args: "cron:check-hedges --live",
      cron_restart: "3-59/5 * * * *",
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
    },

    // Resolved Positions Sync - syncs resolved positions to DB for analytics dashboard
    // Runs at :07,:17,:27... to avoid collision with other crons
    {
      name: "resolved-positions-sync",
      script: "pnpm",
      args: "cron:sync-resolved-positions",
      cron_restart: "7-59/10 * * * *",
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
    },
  ],
};
