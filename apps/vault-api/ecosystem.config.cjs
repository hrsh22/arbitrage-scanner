module.exports = {
  apps: [
    {
      name: "vault-api",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "vault-capital-worker",
      script: "dist/worker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "vault-resolution-worker",
      script: "dist/tradingWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "vault-analytics-sync",
      script: "pnpm",
      args: "cron:sync-vault-analytics",
      cron_restart: "7-59/10 * * * *",
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        VAULT_NETWORK: "mainnet",
      },
    },
  ],
};
