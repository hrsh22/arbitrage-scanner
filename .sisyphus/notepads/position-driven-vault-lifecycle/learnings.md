Notes from flatbook-lifecycle.spec.ts:

- Implemented deterministic Playwright tests for four lifecycle modes via route-mocked API:
  1. instant mode
  2. queued mode
  3. stale telemetry mode
  4. preflight withdraw mode with timeout and error paths
- Tests reload the vault page to trigger mocked API responses and validate user-visible state:
  - Instant deposits: instant text and enabled Deposit button
  - Queued mode: queued banner and disabled Deposit button
  - Stale telemetry: banner shown and actions blocked
  - Preflight withdraw: timeout and error banners with disabled or blocked actions
- File created: apps/vault-web/e2e/flatbook-lifecycle.spec.ts
