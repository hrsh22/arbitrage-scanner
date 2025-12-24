# API Endpoints (Polymarket Arbitrage Scanner)

Base URL defaults to `http://localhost:8080`.

## Health Checks

- `GET /health`  
  Returns `{ status, uptime, lastUpdated }`.

- `GET /health/db`  
  Pings Postgres; 200 on success.

## Opportunities API

- `GET /opportunities`  
  Current in-memory arbitrage opportunities. Query params:
  - `minProfitPct`: number (%) - minimum profit percentage
  - `minLiquidity`: number (USD) - minimum available liquidity
  - `sort`: `score | profit | liquidity | newest` (default: score)

  Response:

  ```json
  {
    "opportunities": [
      {
        "key": "arb:123",
        "type": "arbitrage",
        "question": "Will X happen?",
        "marketId": "123",
        "marketSlug": "will-x-happen",
        "marketUrl": "https://polymarket.com/event/will-x-happen",
        "outcomes": [
          { "name": "Yes", "askPrice": 0.48, "liquidity": 1000 },
          { "name": "No", "askPrice": 0.49, "liquidity": 800 }
        ],
        "totalCost": 0.97,
        "profitAbsolute": 0.03,
        "profitPercentage": 3.09,
        "availableLiquidity": 800,
        "score": 5.67,
        "closesAt": "2024-12-31T23:59:59Z",
        "detectedAt": "2024-12-15T08:00:00Z"
      }
    ],
    "lastUpdated": "2024-12-15T08:00:00Z"
  }
  ```

- `GET /opportunities/history`  
  Recent opportunities from database. Query:
  - `limit`: max rows (default 100)

- `GET /opportunities/stats`  
  Aggregated stats.

- `POST /opportunities/:key/action`  
  Record action against opportunity.
  Body: `{ action: "executed" | "missed", investment?: number, actualProfit?: number }`

## Configuration

Environment variables (see `.env.example`):

- `MAX_EVENTS`: Top N most liquid events to scan (default: 500)
- `POLL_INTERVAL_MS`: Polling interval (default: 7000ms)
- `MIN_LIQUIDITY_USD`: Minimum liquidity filter (default: 50)
- `MIN_PROFIT_PCT`: Minimum profit % to show (default: 0)
