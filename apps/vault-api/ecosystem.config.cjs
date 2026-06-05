module.exports = {
  apps: [
    {
      name: "vault-api-server",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "vault-api-worker",
      script: "dist/worker.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "vault-analytics-sync",
      script: "dist/cron/syncVaultAnalytics.js",
      instances: 1,
      exec_mode: "fork",
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
