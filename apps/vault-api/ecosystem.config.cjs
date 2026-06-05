module.exports = {
  apps: [
    {
      name: "vault-api-server",
      script: "pnpm",
      args: "run dev",
      autorestart: true,
      watch: false,
    },
    {
      name: "vault-api-worker",
      script: "pnpm",
      args: "run worker",
      autorestart: true,
      watch: false,
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
