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
 *   - Trading bot scan: Every 5 minutes (fetches markets once, runs all bots in parallel)
 *   - Resolution check: Every 10 minutes (checks all bot positions for resolution)
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
  ],
};
