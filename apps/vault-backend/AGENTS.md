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
│   ├── lib/         # Shared Effect.ts infrastructure
│   │   ├── auth/    # Admin authentication (Effect-based)
│   │   ├── blockchain/ # Blockchain sync utilities
│   │   ├── errors/  # Typed error definitions
│   │   └── rpc/     # Shared RPC client with fallback
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

| File                                   | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `src/index.ts`                         | Server entry point and middleware configuration            |
| `src/db/schema.ts`                     | Database schema for users, vaults, deposits, and positions |
| `src/lib/errors/index.ts`              | Typed errors using Effect.ts `Data.TaggedError`            |
| `src/lib/rpc/client.ts`                | Shared RPC client Layer with fallback support              |
| `src/lib/auth/admin.ts`                | Effect-based admin authentication middleware               |
| `src/services/vaultContractService.ts` | V2-only vault contract interactions with Effect wrappers   |
| `src/services/depositListener.ts`      | Deposit event detection using Effect.ts                    |
| `src/services/withdrawalListener.ts`   | Withdrawal event detection using Effect.ts                 |
| `src/trading/tradingService.ts`        | Polymarket CLOB integration with API key management        |
| `src/trading/safeWallet.ts`            | Gnosis Safe operations (approvals, transfers, multi-sig)   |
| `src/services/vaultService.ts`         | Logic for vault management and NAV calculations            |
| `src/services/userService.ts`          | User profile and position management                       |
| `src/routes/webhooks.ts`               | Alchemy webhook endpoints for deposit events               |
| `src/cron/reconcileDeposits.ts`        | Cron job for deposit reconciliation                        |

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

| Date       | Change                                                      | Files Affected                                                   |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-01-27 | Effect.ts refactor: shared RPC layer, typed errors, V2-only | lib/rpc/, lib/errors/, lib/blockchain/, lib/auth/                |
| 2026-01-27 | Refactored depositListener/withdrawalListener to Effect.ts  | depositListener.ts, withdrawalListener.ts                        |
| 2026-01-27 | vaultContractService now V2-only with Effect wrappers       | vaultContractService.ts                                          |
| 2026-01-27 | Removed V1 merkle code (dead code)                          | merkleService.ts (deleted), withdrawalService.ts, withdrawals.ts |
| 2026-01-27 | Effect-based admin auth middleware                          | lib/auth/admin.ts, routes/admin.ts                               |
| 2026-01-27 | processWithdrawals.ts now V2-only                           | cron/processWithdrawals.ts                                       |
| 2026-01-23 | Added deposit event listener (webhook + catch-up)           | depositListener.ts, webhooks.ts, reconcileDeposits.ts            |
| 2026-01-23 | Added syncState table for block tracking                    | schema.ts                                                        |

## Effect.ts Architecture

The codebase uses [Effect.ts](https://effect.website/) for typed error handling and composable async operations.

### Key Modules

| Module                       | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `src/lib/errors/index.ts`    | Typed errors using `Data.TaggedError`   |
| `src/lib/rpc/client.ts`      | Shared RPC client with fallback support |
| `src/lib/blockchain/sync.ts` | Reusable blockchain sync utilities      |
| `src/lib/auth/admin.ts`      | Effect-based admin authentication       |

### Error Types

```typescript
import { RpcError, ContractError, WalletNotConfiguredError } from "./lib/errors/index.js";
```

### Running Effect Programs

```typescript
import { Effect, pipe } from "effect";
import { RpcClientLive } from "./lib/rpc/client.js";

const program = pipe(someEffect, Effect.provide(RpcClientLive), Effect.runPromise);
```

### Contract Version

**This codebase is V2-ONLY.** All V1 merkle-based claim logic has been removed. The vault contract uses signature-based claims (`signClaim()`) instead of merkle proofs.
