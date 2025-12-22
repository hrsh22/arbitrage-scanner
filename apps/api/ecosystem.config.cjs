/**
 * PM2 Ecosystem Configuration
 * 
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 * 
 * Commands:
 *   pm2 list                           - View all processes
 *   pm2 logs                           - View all logs
 *   pm2 logs arbitrage-scanner-node    - View API logs
 *   pm2 restart all                    - Restart everything
 *   pm2 stop all                       - Stop everything
 */

module.exports = {
    apps: [
        // Main API Server
        {
            name: 'arbitrage-scanner-node',
            script: 'dist/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            env: {
                NODE_ENV: 'production',
            },
        },

        // Trading Bot Scan - every 5 minutes
        {
            name: 'cron-trading-bot',
            script: 'pnpm',
            args: 'cron:run-trading-bot',
            cron_restart: '*/5 * * * *',
            autorestart: false,
            watch: false,
            env: {
                NODE_ENV: 'production',
                LOG_LEVEL: 'info',
            },
        },

        // Resolution Checker - every 10 minutes
        {
            name: 'cron-check-resolutions',
            script: 'pnpm',
            args: 'cron:check-bot-resolutions',
            cron_restart: '*/10 * * * *',
            autorestart: false,
            watch: false,
            env: {
                NODE_ENV: 'production',
                LOG_LEVEL: 'info',
            },
        },
    ],
}

