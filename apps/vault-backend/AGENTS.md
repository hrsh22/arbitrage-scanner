# AGENTS.md

This document provides context and guidelines for AI coding assistants working on the Polymarket Vault Backend.

## Project Overview

**Polymarket Vault Backend** is an Express.js system that manages a prediction market investment vault. It handles user deposits, withdrawals, and automated trading on Polymarket using a Gnosis Safe as the treasury. Users deposit USDC and receive vault shares (pvUSDC), with the Net Asset Value (NAV) increasing as the vault generates profits from successful predictions.

## Architecture

This application is part of a Turborepo monorepo and is located in `apps/vault-backend/`.

### Directory Structure

```
apps/vault-backend/
├── src/
│   ├── cron/        # Standalone cron job scripts
│   ├── db/          # Drizzle ORM schema and database client
│   ├── routes/      # Express API routes
│   ├── services/    # Core business logic
│   ├── trading/     # Polymarket and Gnosis Safe integration
│   ├── scripts/     # Utility and setup scripts
│   ├── index.ts     # Entry point
│   ├── env.ts       # Environment variable configuration
│   ├── logger.ts    # Winston logging utility
│   └── types.ts     # Shared TypeScript interfaces
└── drizzle/         # Database migrations
```

## Key Files

| File                              | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `src/index.ts`                    | Server entry point and middleware configuration            |
| `src/db/schema.ts`                | Database schema for users, vaults, deposits, and positions |
| `src/trading/tradingService.ts`   | Polymarket CLOB integration with API key management        |
| `src/trading/safeWallet.ts`       | Gnosis Safe operations (approvals, transfers, multi-sig)   |
| `src/trading/relayer.ts`          | Transaction relaying using the Safe SDK                    |
| `src/services/vaultService.ts`    | Logic for vault management and NAV calculations            |
| `src/services/userService.ts`     | User profile and position management                       |
| `src/services/claimService.ts`    | Logic for processing position claims                       |
| `src/services/depositListener.ts` | Deposit event detection and sync from blockchain           |
| `src/routes/webhooks.ts`          | Alchemy webhook endpoints for deposit events               |
| `src/cron/reconcileDeposits.ts`   | Cron job for deposit reconciliation                        |

## API Endpoints

### Public / User Routes

| Endpoint          | Method | Description                                   |
| ----------------- | ------ | --------------------------------------------- |
| `/vaults`         | GET    | List all vaults and their current status      |
| `/users/:address` | GET    | Get user positions, deposits, and withdrawals |

### Admin / Trading Routes

| Endpoint                               | Method | Description                               |
| -------------------------------------- | ------ | ----------------------------------------- |
| `/admin/vaults`                        | POST   | Create or update vault configuration      |
| `/admin/vaults/:id/orders`             | GET    | Retrieve open orders for a specific vault |
| `/admin/vaults/:id/orders`             | POST   | Place a new trading order on Polymarket   |
| `/admin/vaults/:id/orders`             | DELETE | Cancel all open orders for a vault        |
| `/admin/vaults/:id/orders/:orderId`    | DELETE | Cancel a specific order                   |
| `/admin/vaults/:id/market/:tokenId`    | GET    | Get current market price for a token      |
| `/admin/vaults/:id/orderbook/:tokenId` | GET    | Get orderbook for a specific token        |

## Environment Variables

| Variable                     | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| `VAULT_DATABASE_URL`         | PostgreSQL connection string                               |
| `POLYGON_RPC_URL`            | RPC endpoint for Polygon mainnet                           |
| `TRADING_WALLET_PRIVATE_KEY` | Key for signing Safe transactions and deriving PM API keys |
| `ALCHEMY_WEBHOOK_SECRET`     | Signing key from Alchemy webhook (for deposit detection)   |

**Constants (Hardcoded):**

- `POLYMARKET_CLOB_URL`: `https://clob.polymarket.com`
- `CHAIN_ID`: `137` (Polygon Mainnet)

## Commands

```bash
pnpm dev              # Start development server with hot reload
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Apply migrations to the database
pnpm setup-safe <SAFE_ADDRESS>  # Run one-time Gnosis Safe setup script
pnpm cron:reconcile-deposits    # Run deposit reconciliation (catch-up missed events)
```

## Coding Conventions

### TypeScript & Structure

- Strict mode is enabled
- Use ES modules (require `.js` extensions in imports)
- Prefer `interface` over `type` for object definitions
- Use the repository pattern or service layer for database access

### Error Handling & Logging

- Use the centralized `logger.ts` (Winston)
- Include context in logs: `logger.error("Message", { error: (error as Error).message })`
- Return `{ success: boolean, error?: string }` for complex operations

### Naming

- Files: camelCase (e.g., `vaultService.ts`)
- Classes: PascalCase (e.g., `TradingService`)
- Constants: UPPER_SNAKE_CASE

## Do's and Don'ts

### Do's

- Always use the `tradingService` for interacting with Polymarket
- Verify Safe transaction relaying through the `relayer`
- Ensure all sensitive keys are kept in environment variables
- Log significant state changes (deposits, trades, NAV updates)

### Don'ts

- Do NOT hardcode API keys or private keys
- Do NOT bypass the Gnosis Safe treasury for trading
- Do NOT modify the database schema without a proper migration
- Do NOT use non-Polygon network configurations

## Recent Changes

| Date       | Change                                            | Files Affected                                        |
| ---------- | ------------------------------------------------- | ----------------------------------------------------- |
| 2026-01-23 | Added deposit event listener (webhook + catch-up) | depositListener.ts, webhooks.ts, reconcileDeposits.ts |
| 2026-01-23 | Added syncState table for block tracking          | schema.ts                                             |
