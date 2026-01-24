# AGENTS.md

This document provides context and guidelines for AI coding assistants working on the Polymarket Vault Frontend.

## Project Overview

**Polymarket Vault Frontend** is a React-based dashboard for the Polymarket Vault system. It uses TanStack Router for type-safe routing and shadcn/ui for components. The application enables users to connect their wallets via Reown (WalletConnect), deposit USDC into vaults, withdraw shares, and allows admins to manage vault operations.

## Architecture

This application is part of a Turborepo monorepo and is located in `apps/vault-frontend/`.

### Directory Structure

```
apps/vault-frontend/
├── src/
│   ├── routes/      # File-based routing (TanStack Router)
│   ├── components/  # Shared UI components (shadcn/ui)
│   ├── lib/         # Utilities, API client, and Web3 config
│   ├── styles/      # Global CSS and Tailwind configuration
│   ├── router.tsx   # Router configuration
│   └── routeTree.gen.ts # Generated route tree
```

## Key Files

| File                    | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `src/lib/api.ts`        | Backend API client with typed request/response handlers |
| `src/lib/web3.tsx`      | Reown/wagmi configuration and wallet provider           |
| `src/lib/contracts.ts`  | USDC contract ABI and Polygon mainnet addresses         |
| `src/routes/__root.tsx` | Main layout and navigation structure                    |
| `src/lib/env.ts`        | Frontend environment variable validation (Zod)          |

## Routes

### User Routes

| Path                    | Description                            |
| ----------------------- | -------------------------------------- |
| `/`                     | Landing page / Vault overview          |
| `/vault/$slug/deposit`  | USDC deposit flow for a specific vault |
| `/vault/$slug/withdraw` | Vault share withdrawal flow            |

### Admin Routes

| Path              | Description                                   |
| ----------------- | --------------------------------------------- |
| `/admin`          | Admin dashboard listing managed vaults        |
| `/admin/new`      | Interface for creating a new vault            |
| `/admin/$vaultId` | Detailed management view for a specific vault |

## Environment Variables

| Variable                | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `VITE_REOWN_PROJECT_ID` | Project ID for Reown (WalletConnect) integration |
| `VITE_API_URL`          | Base URL for the backend API                     |

**Constants:**

- `USDC_ADDRESS`: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (Polygon Mainnet)
- `USDC_DECIMALS`: `6`

## Commands

```bash
pnpm dev    # Start development server
pnpm build  # Create production build
pnpm lint   # Run ESLint for code quality checks
```

## Coding Conventions

### Frontend Patterns

- Use **TanStack Router** for all navigation and routing
- Use **shadcn/ui** components for consistent design
- Use **Lucide React** for icons
- Implement responsive designs with **Tailwind CSS**

### Web3 Integration

- Use **wagmi** hooks for all blockchain interactions
- Ensure user wallet connection is handled via the `web3.tsx` provider
- Validate USDC allowances before attempting deposit transactions

### State Management

- Use **TanStack Query** (React Query) for server state management
- Use local React state or URL search params for UI-only state

## Do's and Don'ts

### Do's

- Use the typed API client in `src/lib/api.ts` for all backend requests
- Ensure all numeric values are formatted correctly for the UI (6 decimals for USDC)
- Add loading states and error handling for all asynchronous actions
- Verify the active network is Polygon Mainnet before transactions

### Don'ts

- Do NOT hardcode contract addresses outside of `src/lib/contracts.ts`
- Do NOT use standard `<a>` tags for internal navigation; use TanStack `Link`
- Do NOT perform complex logic inside UI components; move to `lib/` or custom hooks

## Recent Changes

| Date | Change | Files Affected |
| ---- | ------ | -------------- |
|      |        |                |
