import { Router } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { createPublicClient, decodeFunctionData, formatUnits, getAddress, parseUnits } from "viem";
import { getAllVaultConfigs, getVaultConfig } from "../config/index.js";
import { resolveVaultIdentity } from "../config/identityResolver.js";
import type { VaultInstanceConfig } from "../config/types.js";
import {
  USDC_E_ADDRESS,
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEGRISK_CTF_EXCHANGE_ADDRESS,
  NEGRISK_ADAPTER_ADDRESS,
} from "../constants.js";
import { db } from "../db/index.js";
import { navSnapshots, vaultAllocations, withdrawalRequests } from "../db/schema.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { requireAuth } from "../middleware/auth.js";
import { positionRepository } from "../repositories/positionRepository.js";
import { activityEventRepository } from "../repositories/activityEventRepository.js";
import { withdrawalRepository } from "../repositories/withdrawalRepository.js";
import { ResolutionCheckerService } from "../services/resolutionChecker.js";
import { SafeWalletService, type SafeTxResult } from "../services/safeWallet.js";
import { createTradingOrchestrator } from "../services/tradingOrchestrator.js";
import { createVaultTradingClient } from "../services/tradingClient.js";
import { navCalculator } from "../services/navCalculator.js";
import { createNavOracle } from "../services/navOracle.js";
import { positionFetcher } from "../services/positionFetcher.js";
import { vaultTradingAnalyticsService } from "../services/vaultTradingAnalyticsService.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv } from "../config/network.js";
import { pendingTxRegistry } from "../services/pendingTxRegistry.js";
import { LiquidityManager } from "../services/liquidityManager.js";

const LIFECYCLE_CACHE_TTL_MS = 5_000;
const lifecycleCache = new Map<number, { expiresAt: number; value: unknown }>();

async function getCachedLifecycle(config: VaultInstanceConfig): Promise<unknown> {
  const cached = lifecycleCache.get(config.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const lifecycle = await new LiquidityManager({ config }).evaluateFlatBookLifecycle();
  lifecycleCache.set(config.id, {
    value: lifecycle,
    expiresAt: now + LIFECYCLE_CACHE_TTL_MS,
  });
  return lifecycle;
}

function getVaultConfigByAddress(vaultAddress: string): VaultInstanceConfig | undefined {
  const normalized = vaultAddress.toLowerCase();
  return getAllVaultConfigs().find((config) => config.vaultAddress.toLowerCase() === normalized);
}

async function reconcileCustomReadyWithdrawalRequests(
  userAddress: string,
  requests: Array<typeof withdrawalRequests.$inferSelect>,
): Promise<Array<typeof withdrawalRequests.$inferSelect>> {
  const readyRequests = requests.filter((request) => request.status === "ready");
  if (readyRequests.length === 0) {
    return requests;
  }

  const config = getVaultConfigByAddress(readyRequests[0]!.vaultAddress);
  if (!config || config.type !== "custom") {
    return requests;
  }

  const networkConfig = getNetworkConfigFromEnv();
  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: createNetworkTransport(),
  });

  const userShareBalanceRaw = await publicClient.readContract({
    address: config.vaultAddress as Address,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [userAddress as Address],
  });

  let mutated = false;

  for (const request of readyRequests) {
    let requestedShares: bigint;
    try {
      requestedShares = parseUnits(request.shares, VAULT_SHARE_DECIMALS);
    } catch {
      continue;
    }

    if (userShareBalanceRaw >= requestedShares) {
      continue;
    }

    const completed = await withdrawalRepository.markCompletedIdempotent(request.requestId);
    if (!completed.success || completed.alreadyInTargetState) {
      continue;
    }

    mutated = true;
    void activityEventRepository.appendUserVaultActivityEvent({
      vaultId: config.id,
      vaultAddress: request.vaultAddress,
      userAddress,
      eventType: "claim_completed",
      title: "Claim completed",
      detail: "Detected a completed withdrawal claim from the latest wallet state.",
      requestId: request.requestId,
      status: completed.request?.status ?? "completed",
      assetAmount: request.assetsEstimated,
      shareAmount: request.shares,
      occurredAt: completed.request?.completedAt ?? new Date(),
    });
  }

  if (!mutated) {
    return requests;
  }

  return withdrawalRepository.getRequestsByUser(userAddress, readyRequests[0]!.vaultAddress);
}

/** Helper to trigger event-driven reconciliation with duplicate protection */
async function triggerEventReconciliation(
  config: VaultInstanceConfig,
  eventType: string,
): Promise<void> {
  if (
    config.vaultContractType === "closedBookBatchVault" ||
    config.vaultContractType === "flatBookVaultV2"
  ) {
    logger.info("eventReconciliationSkipped", {
      eventType,
      vaultId: config.id,
      reason: "custom_vaults_require_explicit_keeper_maintenance",
    });
    return;
  }

  const vaultId = config.id;
  const vaultAddress = config.vaultAddress;

  const lockResult = pendingTxRegistry.acquireLock(
    vaultId,
    vaultAddress,
    "reconcile",
    "api",
    { ttlMs: 300000 }, // 5 minute TTL
  );

  if (!lockResult.acquired) {
    logger.info("eventReconciliationDispatched", {
      eventType,
      vaultId,
      lockAcquired: false,
      reason: "Reconciliation already in progress, skipping duplicate dispatch",
    });
    return;
  }

  logger.info("eventReconciliationDispatched", {
    eventType,
    vaultId,
    lockAcquired: true,
    source: "api",
  });

  // Fire-and-forget: run reconciliation asynchronously without blocking
  (async () => {
    try {
      const liquidityManager = new LiquidityManager({ config });
      const result = await liquidityManager.runReconciliation();

      logger.info("eventReconciliationCompleted", {
        eventType,
        vaultId,
        action: result.action,
        amount: result.amount,
        details: result.details,
      });
    } catch (error) {
      logger.error("eventReconciliationFailed", {
        eventType,
        vaultId,
        error: (error as Error).message,
      });
    } finally {
      pendingTxRegistry.releaseLock(vaultId, "reconcile");
    }
  })();
}

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_TOTAL_SUPPLY_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// previewRedeem removed - no dependency on Morpho adapter semantics
// Use share price based calculation instead
// ABI for reading boundary NAV from custom vaults (excludes queued/reserved)
const CUSTOM_VAULT_NAV_ABI = [
  {
    type: "function",
    name: "currentNAV",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastNAVUpdate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Legacy vault share price calculation (totalAssets / totalSupply)
// DEPRECATED: Use boundary NAV from contract for custom vaults
const VAULT_SHARE_PRICE_ABI = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_REDEEM_ABI = [
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "onBehalf", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

async function verifyWithdrawalCompletionTx(params: {
  txHash: Hex;
  requestId: string;
  vaultAddress: string;
  userAddress: string;
  shares: string;
  readyAt: Date | null;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    const reusedTx = await db.query.withdrawalRequests.findFirst({
      where: and(
        eq(withdrawalRequests.txHash, params.txHash),
        ne(withdrawalRequests.requestId, params.requestId),
      ),
    });

    if (reusedTx) {
      return {
        valid: false,
        error: "Claim transaction hash was already used for another request.",
      };
    }

    const networkConfig = getNetworkConfigFromEnv();
    const publicClient = createPublicClient({
      chain: networkConfig.chain,
      transport: createNetworkTransport(),
    });

    const receipt = await publicClient.getTransactionReceipt({ hash: params.txHash });
    if (receipt.status !== "success") {
      return { valid: false, error: "Claim transaction did not succeed on-chain." };
    }

    if (params.readyAt) {
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      const txTimestampMs = Number(block.timestamp) * 1000;
      if (txTimestampMs < params.readyAt.getTime()) {
        return {
          valid: false,
          error: "Claim transaction was mined before this request became ready.",
        };
      }
    }

    const tx = await publicClient.getTransaction({ hash: params.txHash });
    if (!tx.to) {
      return { valid: false, error: "Claim transaction is missing a destination address." };
    }

    const normalizedVault = getAddress(params.vaultAddress as Address);
    const normalizedUser = getAddress(params.userAddress as Address);

    if (getAddress(tx.to) !== normalizedVault) {
      return { valid: false, error: "Claim transaction was sent to the wrong contract." };
    }

    if (getAddress(tx.from) !== normalizedUser) {
      return { valid: false, error: "Claim transaction was not sent by the connected wallet." };
    }

    const decoded = decodeFunctionData({ abi: VAULT_REDEEM_ABI, data: tx.input });
    if (decoded.functionName !== "redeem") {
      return { valid: false, error: "Claim transaction did not call redeem." };
    }

    const [shares, receiver, onBehalf] = decoded.args;
    const expectedShares = parseUnits(params.shares, VAULT_SHARE_DECIMALS);

    if (shares !== expectedShares) {
      return { valid: false, error: "Claim transaction redeemed the wrong share amount." };
    }

    if (getAddress(receiver) !== normalizedUser || getAddress(onBehalf) !== normalizedUser) {
      return {
        valid: false,
        error: "Claim transaction receiver does not match the connected wallet.",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unable to verify claim transaction.",
    };
  }
}

const USDC_DECIMALS = 6;
const VAULT_SHARE_DECIMALS = 6;

const DEFAULT_VAULT_PROFILE = {
  strategy: "custom",
  strategyLabel: "Custom Strategy",
  description: "Vault managed by configured trading strategy",
  longDescription: "Vault details are configured on backend and surfaced through the API.",
  riskLevel: "medium" as const,
  minDeposit: 1,
  maxDeposit: 1000000,
  fees: {
    management: 0,
    performance: 0,
    withdrawal: 0,
  },
};

function getVaultSlug(config: VaultInstanceConfig): string {
  return config.slug ?? `vault-${config.id}`;
}

function getVaultProfile(config: VaultInstanceConfig) {
  return config.profile ?? DEFAULT_VAULT_PROFILE;
}

interface VaultLivePosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  costBasis: number;
  curPrice: number;
  currentValue?: number;
  realizedPnl?: number;
  cashPnl?: number;
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
  endDate: string;
  redeemable: boolean;
  status: "open" | "redeemable" | "closed";
}

async function getLivePositions(config: VaultInstanceConfig): Promise<VaultLivePosition[]> {
  const openPositions = await positionFetcher.fetchOpenPositions(config.safeAddress);

  return openPositions.map((position) => ({
    ...position,
    status: "open" as const,
  }));
}

async function getLivePositionHistory(config: VaultInstanceConfig): Promise<VaultLivePosition[]> {
  const history = await positionFetcher.fetchPositionHistory(config.safeAddress);

  return history.map((position) => ({
    ...position,
  }));
}

function getPrimaryVaultConfig(): VaultInstanceConfig {
  const configs = getAllVaultConfigs();
  const primary = configs.find((config) => config.enabled) ?? configs[0];
  if (!primary) {
    throw new Error("No vault configuration available");
  }
  return primary;
}

function getEffectiveMode(config: VaultInstanceConfig): "simulation" | "live" {
  return env.VAULT_MODE === "live" && config.enabled ? "live" : "simulation";
}

async function getVaultCapState(config: VaultInstanceConfig): Promise<{
  maxAllowedDeployed: number;
  currentDeployed: number;
  headroom: number;
  constraintSource: "policy_cap" | "no_headroom" | "nav_stale";
} | null> {
  void config;
  return null;
}
function createResolutionCheckerForConfig(config: VaultInstanceConfig): ResolutionCheckerService {
  const identity = resolveVaultIdentity(config);
  const safeWallet = new SafeWalletService(
    config.safeAddress,
    identity.safeOperatorKey,
    env.POLYGON_RPC_URL,
  );
  const navOracle = createNavOracle(config);
  return new ResolutionCheckerService(positionRepository, navOracle, safeWallet, config);
}

async function getVaultStatusPayload(config: VaultInstanceConfig): Promise<any> {
  let lifecycle: any;
  try {
    lifecycle = await getCachedLifecycle(config);
  } catch {
    lifecycle = undefined;
  }

  const latestSnapshotsPromise =
    config.type === "custom"
      ? db
          .select({
            totalAssets: navSnapshots.totalAssets,
            idleAssets: navSnapshots.totalAssets,
            deployedCostBasis: navSnapshots.totalAssets,
            sharePrice: navSnapshots.sharePrice,
            timestamp: navSnapshots.timestamp,
          })
          .from(navSnapshots)
          .where(eq(navSnapshots.vaultAddress, config.vaultAddress))
          .orderBy(desc(navSnapshots.timestamp))
          .limit(1)
      : navCalculator.getNavHistory(1);

  const [openPositions, redeemablePositions, snapshots, capState] = await Promise.all([
    positionFetcher.fetchOpenPositions(config.safeAddress),
    positionFetcher.fetchRedeemablePositions(config.safeAddress),
    latestSnapshotsPromise,
    getVaultCapState(config),
  ]);

  const latestNav = snapshots[0];
  const latestTotalAssets = latestNav ? Number.parseFloat(String(latestNav.totalAssets)) : 0;
  const latestIdleAssets = latestNav ? Number.parseFloat(String(latestNav.idleAssets)) : 0;
  const latestDeployed = latestNav ? Number.parseFloat(String(latestNav.deployedCostBasis)) : 0;
  const latestSharePrice = latestNav ? Number.parseFloat(String(latestNav.sharePrice)) : 0;

  let idleAssets = 0;
  let vaultUsdc = 0;
  let safeUsdc = 0;
  let deployedCostBasis = 0;
  let redeemableCostBasis = 0;
  let totalAssets = 0;
  let sharePrice = 1;
  let lastUpdated = latestNav
    ? new Date(String(latestNav.timestamp)).toISOString()
    : new Date().toISOString();
  let customStatusReadSucceeded = false;

  try {
    const networkConfig = getNetworkConfigFromEnv();
    const publicClient = createPublicClient({
      chain: networkConfig.chain,
      transport: createNetworkTransport(),
    });

    // For custom vaults, use boundary NAV from contract (excludes queued/reserved)
    if (config.type === "custom") {
      try {
        const livePreview = await createNavOracle(config).getLiveNavPreview();
        const [lastNavUpdateRaw, totalSupplyRaw] = await Promise.all([
          publicClient.readContract({
            address: config.vaultAddress as Address,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "lastNAVUpdate",
          }),
          publicClient.readContract({
            address: config.vaultAddress as Address,
            abi: VAULT_TOTAL_SUPPLY_ABI,
            functionName: "totalSupply",
          }),
        ]);

        vaultUsdc = livePreview.vaultUsdc;
        safeUsdc = livePreview.safeUsdc;
        idleAssets = livePreview.idleAssets;
        deployedCostBasis = livePreview.deployedCostBasis;
        totalAssets = livePreview.totalAssets;
        sharePrice = livePreview.sharePrice;
        lastUpdated = new Date(Number(lastNavUpdateRaw) * 1000).toISOString();
        customStatusReadSucceeded = true;

        logger.debug("Vault API: Using live NAV preview for custom vault status", {
          vaultId: config.id,
          pricingSupply: livePreview.pricingSupply,
          sharePrice,
          totalAssets,
          vaultUsdc,
          safeUsdc,
          idleAssets,
        });
      } catch (error) {
        logger.warn("Vault API: Failed to read boundary NAV for custom vault, falling back", {
          vaultId: config.id,
          error: (error as Error).message,
        });
        // Fall through to legacy calculation
      }
    }

    // For legacy vaults OR if custom vault boundary NAV read failed
    if (config.type !== "custom" || !customStatusReadSucceeded) {
      const [vaultUsdcRaw, safeUsdcRaw, totalSupplyRaw] = await Promise.all([
        publicClient.readContract({
          address: USDC_E_ADDRESS as Address,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [config.vaultAddress as Address],
        }),
        publicClient.readContract({
          address: USDC_E_ADDRESS as Address,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [config.safeAddress as Address],
        }),
        publicClient.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_TOTAL_SUPPLY_ABI,
          functionName: "totalSupply",
        }),
      ]);

      vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
      safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
      const totalSupply = Number(formatUnits(totalSupplyRaw, VAULT_SHARE_DECIMALS));

      idleAssets = vaultUsdc + safeUsdc;
      deployedCostBasis = openPositions.reduce((sum, position) => sum + position.costBasis, 0);
      redeemableCostBasis = redeemablePositions.reduce(
        (sum, position) => sum + position.costBasis,
        0,
      );
      totalAssets = idleAssets + deployedCostBasis;
      sharePrice = totalSupply > 0 ? totalAssets / totalSupply : 1;

      logger.debug("Vault API: Using raw ratio for legacy vault status", {
        vaultId: config.id,
        totalAssets,
        totalSupply,
        sharePrice,
      });
    }
  } catch (error) {
    logger.warn("Vault API: Falling back to NAV snapshot values for status", {
      vaultId: config.id,
      error: (error as Error).message,
    });
  }

  // Fallback to NAV snapshot if on-chain reads failed
  if (!customStatusReadSucceeded && totalAssets <= 0 && latestTotalAssets > 0) {
    totalAssets = latestTotalAssets;
    idleAssets = latestIdleAssets;
    deployedCostBasis = latestDeployed;
    redeemableCostBasis = redeemablePositions.reduce(
      (sum, position) => sum + position.costBasis,
      0,
    );
    sharePrice = latestSharePrice > 0 ? latestSharePrice : sharePrice;
  }

  const deployedRatio = totalAssets > 0 ? deployedCostBasis / totalAssets : 0;
  const committedExposureRatio =
    totalAssets > 0 ? (deployedCostBasis + redeemableCostBasis) / totalAssets : 0;

  return {
    nav: {
      totalAssets,
      idleAssets,
      vaultUsdc,
      safeUsdc,
      deployedCostBasis,
      redeemableCostBasis,
      sharePrice,
      positionCount: openPositions.length,
      redeemableCount: redeemablePositions.length,
      lastUpdated,
    },
    positionCount: openPositions.length,
    deployedRatio,
    committedExposureRatio,
    totalCostBasis: deployedCostBasis,
    mode: getEffectiveMode(config),
    capState,
    riskState: lifecycle?.riskState ?? "unknown",
    executionMode: lifecycle?.executionMode ?? "blocked",
    telemetryFresh: lifecycle?.telemetryFresh ?? false,
    openPositionCount: lifecycle?.openPositionCount ?? null,
    liquidityMode: lifecycle?.liquidityMode ?? "queued_only",
    reopenReady: lifecycle?.reopenReady ?? false,
  };
}

export function getVaultMode(): "simulation" | "live" {
  try {
    return getEffectiveMode(getPrimaryVaultConfig());
  } catch {
    return "simulation";
  }
}

export function buildVaultRouter(): Router {
  const router = Router();

  router.get("/instances", async (_req, res) => {
    try {
      const configs = getAllVaultConfigs();
      const instances = configs.map((config) => ({
        id: config.id,
        slug: getVaultSlug(config),
        name: config.name,
        enabled: config.enabled,
        type: config.type,
        profile: getVaultProfile(config),
        mode: getEffectiveMode(config),
        config: {
          vaultAddress: config.vaultAddress,
          safeAddress: config.safeAddress,
          betSize: config.betSize,
          dailyBudget: config.dailyBudget,
          minOdds: config.minOdds,
          maxOdds: config.maxOdds,
          maxHoursGeneral: config.maxHoursGeneral,
          hedgingEnabled: config.hedging.enabled,
        },
        intervals: {
          navRefreshMin: config.navRefreshIntervalMin,
          reconciliationMin: config.reconciliationIntervalMin,
          tradingScanMin: config.tradingScanIntervalMin,
          resolutionCheckMin: config.resolutionCheckIntervalMin,
        },
      }));
      res.json({ instances, total: instances.length });
    } catch (error) {
      logger.error("Vault API: Failed to get vault instances", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /vault/status
  router.get("/status", async (req, res) => {
    try {
      const queryVaultId = Number.parseInt(String(req.query.vaultId ?? ""), 10);
      const config = Number.isFinite(queryVaultId)
        ? (getVaultConfig(queryVaultId) ?? getPrimaryVaultConfig())
        : getPrimaryVaultConfig();

      const payload = await getVaultStatusPayload(config);
      res.json({
        vaultId: config.id,
        vaultSlug: getVaultSlug(config),
        vaultName: config.name,
        profile: getVaultProfile(config),
        ...payload,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get status", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/:vaultId/trading-analytics", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId ?? "", 10);
      if (Number.isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      const analytics = await vaultTradingAnalyticsService.syncForVault(config.vaultAddress);

      res.json({
        vaultId: config.id,
        vaultSlug: getVaultSlug(config),
        vaultName: config.name,
        analytics,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get trading analytics", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /vault/positions
  router.get("/positions", async (req, res) => {
    try {
      const queryVaultId = Number.parseInt(String(req.query.vaultId ?? ""), 10);
      const config = Number.isFinite(queryVaultId)
        ? (getVaultConfig(queryVaultId) ?? getPrimaryVaultConfig())
        : getPrimaryVaultConfig();
      const positions = await getLivePositions(config);

      res.json({
        vaultId: config.id,
        positions,
        total: positions.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get positions", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/position-history", async (req, res) => {
    try {
      const queryVaultId = Number.parseInt(String(req.query.vaultId ?? ""), 10);
      const config = Number.isFinite(queryVaultId)
        ? (getVaultConfig(queryVaultId) ?? getPrimaryVaultConfig())
        : getPrimaryVaultConfig();
      const positions = await getLivePositionHistory(config);

      res.json({
        vaultId: config.id,
        positions,
        total: positions.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get position history", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /vault/nav-history
  router.get("/nav-history", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 24;
      const snapshots = await navCalculator.getNavHistory(limit);

      res.json({
        snapshots,
        total: snapshots.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get NAV history", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /vault/allocations
  router.get("/allocations", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;

      const allocations = await db
        .select()
        .from(vaultAllocations)
        .orderBy(desc(vaultAllocations.timestamp))
        .limit(limit);

      res.json({
        allocations,
        total: allocations.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get allocations", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/safe/setup", async (_req, res) => {
    try {
      // Get primary vault config and resolve identity for Safe operations
      const config = getPrimaryVaultConfig();
      const identity = resolveVaultIdentity(config);

      // Run approvals individually — reinitialize Safe for each tx to avoid nonce cache staleness (GS026)
      const exchanges = [
        { name: "CTF Exchange", address: CTF_EXCHANGE_ADDRESS },
        { name: "NegRisk CTF Exchange", address: NEGRISK_CTF_EXCHANGE_ADDRESS },
        { name: "NegRisk Adapter", address: NEGRISK_ADAPTER_ADDRESS },
      ];
      const results: Array<{ name: string; token: string; result: SafeTxResult }> = [];

      // Build a flat list of all approvals to execute
      const approvals: Array<{
        name: string;
        token: string;
        spender?: string;
        exec: (s: SafeWalletService) => Promise<SafeTxResult>;
      }> = [];
      for (const exchange of exchanges) {
        approvals.push({
          name: exchange.name,
          token: "USDC.e",
          spender: exchange.address,
          exec: (s) => s.approveToken(USDC_E_ADDRESS, exchange.address),
        });
        approvals.push({
          name: exchange.name,
          token: "CTF",
          exec: (s) => s.setApprovalForAll(CTF_ADDRESS, exchange.address),
        });
      }
      const createInitializedSafe = async (): Promise<SafeWalletService> => {
        const safe = new SafeWalletService(
          config.safeAddress,
          identity.safeOperatorKey,
          env.POLYGON_RPC_URL,
        );
        await safe.initialize();
        return safe;
      };

      const hasSufficientAllowance = (allowance: bigint, safe: SafeWalletService): boolean => {
        return allowance >= safe.getMaxUint256() / 2n;
      };

      // Execute each approval with a fresh SafeWalletService instance to avoid nonce caching
      for (const approval of approvals) {
        const safe = await createInitializedSafe();

        if (approval.token === "USDC.e" && approval.spender) {
          const currentAllowance = await safe.getAllowance(USDC_E_ADDRESS, approval.spender);
          if (hasSufficientAllowance(currentAllowance, safe)) {
            results.push({
              name: approval.name,
              token: approval.token,
              result: { success: true },
            });
            continue;
          }
        }

        let result = await approval.exec(safe);

        if (!result.success && result.error?.includes("GS026")) {
          logger.warn(
            `Safe setup: Retry after GS026 for ${approval.token} approval on ${approval.name}`,
          );
          const retrySafe = await createInitializedSafe();
          result = await approval.exec(retrySafe);
        }

        if (!result.success && approval.token === "USDC.e" && approval.spender) {
          const verificationSafe = await createInitializedSafe();
          const allowanceAfterFailure = await verificationSafe.getAllowance(
            USDC_E_ADDRESS,
            approval.spender,
          );

          if (hasSufficientAllowance(allowanceAfterFailure, verificationSafe)) {
            logger.info(
              `Safe setup: Allowance already sufficient for ${approval.name}; marking approval as successful`,
              {
                spender: approval.spender,
                allowance: allowanceAfterFailure.toString(),
              },
            );
            result = { success: true };
          }
        }

        results.push({ name: approval.name, token: approval.token, result });

        if (!result.success) {
          logger.error(`Safe setup: ${approval.token} approval failed for ${approval.name}`, {
            error: result.error,
          });
        }
      }
      const allSuccess = results.every((r) => r.result.success);
      res.json({
        success: allSuccess,
        approvals: results.map((r) => ({
          name: r.name,
          token: r.token,
          success: r.result.success,
          txHash: r.result.txHash,
          error: r.result.error,
        })),
      });
    } catch (error) {
      logger.error("Vault API: Safe setup failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/safe/status", async (_req, res) => {
    try {
      const config = getPrimaryVaultConfig();
      const identity = resolveVaultIdentity(config);
      const safe = new SafeWalletService(
        config.safeAddress,
        identity.safeOperatorKey,
        env.POLYGON_RPC_URL,
      );
      await safe.initialize();

      const [safeInfo, balance] = await Promise.all([
        safe.getSafeInfo(),
        safe.getBalance(USDC_E_ADDRESS),
      ]);

      res.json({
        safeInfo: { ...safeInfo, chainId: Number(safeInfo.chainId) },
        usdcBalance: Number(balance) / 1e6,
      });
    } catch (error) {
      logger.error("Vault API: Safe status failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/trading/status", async (_req, res) => {
    try {
      const config = getPrimaryVaultConfig();
      const tradingClient = createVaultTradingClient(config);
      const initialized = tradingClient.isInitialized();

      const [safeBalance, activeOrders] = initialized
        ? await Promise.all([tradingClient.getBalance(), tradingClient.getActiveOrders()])
        : [0, []];

      res.json({
        initialized,
        safeAddress: tradingClient.getSafeAddress(),
        safeBalance,
        operatorAddress: tradingClient.getOperatorAddress(),
        activeOrdersCount: activeOrders.length,
        vaultId: config.id,
      });
    } catch (error) {
      logger.error("Vault API: Trading status failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /vault/scan
  router.post("/scan", requireAuth, async (_req, res) => {
    try {
      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        logger.info("Vault API: Scan triggered (simulation mode — no execution)");
        res.json({
          success: true,
          message: "Scan triggered (simulation mode — no markets scanned)",
          mode,
          vaultId: config.id,
        });
        return;
      }
      const pendingWithdrawals = await withdrawalRepository.getPendingRequests(config.vaultAddress);
      if (pendingWithdrawals.length > 0) {
        res.status(409).json({
          success: false,
          error: "Pending withdrawal queue takes priority over new trading",
          pendingWithdrawals: pendingWithdrawals.length,
          vaultId: config.id,
        });
        return;
      }

      const startTime = Date.now();
      const navOracle = createNavOracle(config, undefined, config.id);
      const tradingClient = createVaultTradingClient(config);
      const results = await createTradingOrchestrator(
        config,
        tradingClient,
        navOracle,
      ).runScanCycle();
      const duration = Date.now() - startTime;

      logger.info("Vault API: Scan triggered (live mode)", { vaultId: config.id });

      res.json({
        success: true,
        message: "Scan cycle completed",
        mode,
        durationMs: duration,
        results,
        vaultId: config.id,
      });
    } catch (error) {
      logger.error("Vault API: Scan failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/check-resolutions", requireAuth, async (_req, res) => {
    try {
      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        res.json({
          success: true,
          mode,
          vaultId: config.id,
          result: { checked: 0, resolved: 0, won: 0, lost: 0, redeemed: 0, errors: [] },
        });
        return;
      }
      const result = await createResolutionCheckerForConfig(config).checkResolutions();
      res.json({ success: true, result, mode, vaultId: config.id });
    } catch (error) {
      logger.error("Vault API: Resolution check failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /vault/deposit — body: { amount: number }
  router.post("/deposit", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body as { amount?: number };

      if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "amount is required and must be a positive number" });
        return;
      }

      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      logger.info("Vault API: Deposit requested", { amount, mode, vaultId: config.id });

      if (mode !== "live") {
        res.json({
          success: true,
          message: `Deposit of $${amount} simulated (not executed)`,
          mode,
          amount,
          vaultId: config.id,
        });
        return;
      }
      res.status(400).json({
        success: false,
        mode,
        amount,
        vaultId: config.id,
        error:
          "Direct deposit allocation is disabled for custom vault flow. Transfer USDC to the vault address, then run reconciliation.",
      });
    } catch (error) {
      logger.error("Vault API: Deposit failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /vault/withdraw — body: { amount: number }
  router.post("/withdraw", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body as { amount?: number };

      if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "amount is required and must be a positive number" });
        return;
      }

      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      logger.info("Vault API: Withdraw requested", { amount, mode, vaultId: config.id });

      if (mode !== "live") {
        res.json({
          success: true,
          message: `Withdrawal of $${amount} simulated (not executed)`,
          mode,
          amount,
          vaultId: config.id,
        });
        return;
      }
      res.status(400).json({
        success: false,
        mode,
        amount,
        vaultId: config.id,
        error:
          "Direct withdraw is disabled for custom vault flow. Use /vault/withdrawal-request and claim after settlement.",
      });
    } catch (error) {
      logger.error("Vault API: Withdraw failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /vault/allocate — body: { amount: number }
  router.post("/allocate", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body as { amount?: number };

      if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "amount is required and must be a positive number" });
        return;
      }

      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        logger.info("Vault API: Allocate requested (simulation mode)", { amount });
        res.json({
          success: true,
          message: `Allocation of $${amount} simulated (not executed)`,
          mode,
          amount,
          vaultId: config.id,
        });
        return;
      }
      logger.info("Vault API: Allocate endpoint disabled for custom vault flow", { amount });
      res.status(400).json({
        success: false,
        mode,
        amount,
        vaultId: config.id,
        error:
          "Allocate endpoint is disabled for custom vault flow. Use reconciliation and epoch-aware liquidity management.",
      });
    } catch (error) {
      logger.error("Vault API: Allocate failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /vault/deallocate — body: { amount: number }
  router.post("/deallocate", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body as { amount?: number };

      if (amount === undefined || amount === null || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "amount is required and must be a positive number" });
        return;
      }

      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        logger.info("Vault API: Deallocate requested (simulation mode)", { amount });
        res.json({
          success: true,
          message: `Deallocation of $${amount} simulated (not executed)`,
          mode,
          amount,
          vaultId: config.id,
        });
        return;
      }
      logger.info("Vault API: Deallocate endpoint disabled for custom vault flow", { amount });
      res.status(400).json({
        success: false,
        mode,
        amount,
        vaultId: config.id,
        error:
          "Deallocate endpoint is disabled for custom vault flow. Use queued withdrawals and reconciliation.",
      });
    } catch (error) {
      logger.error("Vault API: Deallocate failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /vault/nav-update — force NAV recalculation
  router.post("/nav-update", requireAuth, async (_req, res) => {
    try {
      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        const openPositions = await positionRepository.getOpenPositions();
        const totalCostBasis = openPositions.reduce(
          (sum, pos) => sum + parseFloat(pos.costBasis),
          0,
        );
        const nav = navCalculator.calculateNav(
          0,
          totalCostBasis,
          totalCostBasis,
          0,
          openPositions.length,
        );

        logger.info("Vault API: NAV recalculated (simulation mode — not pushed on-chain)", {
          totalAssets: nav.totalAssets,
          positionCount: nav.positionCount,
        });

        res.json({
          success: true,
          message: "NAV recalculated (simulation mode — not pushed on-chain)",
          mode,
          nav: {
            totalAssets: nav.totalAssets,
            idleAssets: nav.idleAssets,
            deployedCostBasis: nav.deployedCostBasis,
            positionCount: nav.positionCount,
            lastUpdated: nav.lastUpdated.toISOString(),
          },
          vaultId: config.id,
        });
        return;
      }
      const result = await createNavOracle(config).calculateAndPushNav();
      res.json({
        success: true,
        message: "NAV recalculated and pushed on-chain",
        mode,
        result,
        vaultId: config.id,
      });
    } catch (error) {
      logger.error("Vault API: NAV update failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/mode", requireAuth, async (_req, res) => {
    try {
      const config = getPrimaryVaultConfig();
      const mode = getEffectiveMode(config);
      res.json({
        success: false,
        mode,
        vaultId: config.id,
        message:
          "Runtime mode mutation is disabled. Update VAULT_MODE and restart API/worker to change mode.",
      });
    } catch (error) {
      logger.error("Vault API: Failed to switch mode", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ===== Withdrawal Queue Endpoints =====

  // Default slippage threshold (1% = 0.01)
  const DEFAULT_SLIPPAGE_THRESHOLD = 0.01;

  /**
   * Helper to estimate redeemable assets using boundary NAV for custom vaults
   * or share price for legacy vaults.
   *
   * CRITICAL: For custom vaults, uses currentNAV from contract which excludes
   * queued deposits and reserved redemption liabilities (boundary NAV semantics).
   * Falls back to raw totalAssets/totalSupply for legacy vaults only.
   */
  async function estimateRedeemAssets(
    config: VaultInstanceConfig,
    vaultAddress: string,
    shares: string,
  ): Promise<{
    assets: number;
    error?: string;
  }> {
    try {
      if (config.type === "custom") {
        const livePreview = await createNavOracle(config).getLiveNavPreview();
        const sharesUnits = parseUnits(shares, VAULT_SHARE_DECIMALS);
        const assets =
          Number(formatUnits(sharesUnits, VAULT_SHARE_DECIMALS)) * livePreview.sharePrice;

        if (!Number.isFinite(assets) || assets <= 0) {
          return { assets: 0, error: "Invalid estimate calculation" };
        }

        return { assets };
      }

      const networkConfig = getNetworkConfigFromEnv();
      const publicClient = createPublicClient({
        chain: networkConfig.chain,
        transport: createNetworkTransport(),
      });

      const sharesUnits = parseUnits(shares, VAULT_SHARE_DECIMALS);

      // Try to get boundary NAV from custom vault first (excludes queued/reserved)
      let currentNAV: bigint | null = null;
      try {
        currentNAV = await publicClient.readContract({
          address: vaultAddress as Address,
          abi: CUSTOM_VAULT_NAV_ABI,
          functionName: "currentNAV",
        });
      } catch {
        // currentNAV not available on legacy vaults - will fall back to raw ratio
        currentNAV = null;
      }

      let sharePrice: number;

      if (currentNAV !== null && currentNAV > 0n) {
        // Use boundary NAV from contract (custom vault semantics)
        // currentNAV is in 18 decimals, represents assets per share excluding liabilities
        sharePrice = Number(formatUnits(currentNAV, 18));
        logger.debug("estimateRedeemAssets: Using boundary NAV", {
          vaultAddress,
          currentNAV: currentNAV.toString(),
          sharePrice,
        });
      } else {
        // Fall back to raw totalAssets/totalSupply for legacy vaults
        // WARNING: This does not exclude queued deposits or reserved liabilities
        const [totalAssetsRaw, totalSupplyRaw] = await Promise.all([
          publicClient.readContract({
            address: vaultAddress as Address,
            abi: VAULT_SHARE_PRICE_ABI,
            functionName: "totalAssets",
          }),
          publicClient.readContract({
            address: vaultAddress as Address,
            abi: VAULT_SHARE_PRICE_ABI,
            functionName: "totalSupply",
          }),
        ]);

        const totalAssets = Number(formatUnits(totalAssetsRaw, USDC_DECIMALS));
        const totalSupply = Number(formatUnits(totalSupplyRaw, VAULT_SHARE_DECIMALS));
        sharePrice = totalSupply > 0 ? totalAssets / totalSupply : 1;

        logger.debug("estimateRedeemAssets: Using raw ratio (legacy vault)", {
          vaultAddress,
          totalAssets,
          totalSupply,
          sharePrice,
        });
      }

      const assets = Number(formatUnits(sharesUnits, VAULT_SHARE_DECIMALS)) * sharePrice;

      if (!Number.isFinite(assets) || assets <= 0) {
        return { assets: 0, error: "Invalid estimate calculation" };
      }

      return { assets };
    } catch (error) {
      logger.error("estimateRedeemAssets failed", {
        vaultAddress,
        shares,
        error: (error as Error).message,
      });
      return { assets: 0, error: (error as Error).message };
    }
  }

  // POST /vault/withdrawal-request — queue a withdrawal when instant redeem not possible
  router.post("/withdrawal-request", requireAuth, async (req, res) => {
    try {
      const { shares, assetsEstimated, vaultId } = req.body as {
        shares?: string;
        assetsEstimated?: string;
        vaultId?: number;
      };

      if (!shares) {
        res.status(400).json({
          error: "shares is required (string value)",
        });
        return;
      }

      let sharesUnits: bigint;
      try {
        sharesUnits = parseUnits(shares, VAULT_SHARE_DECIMALS);
      } catch {
        res.status(400).json({ error: "shares must be a valid decimal string" });
        return;
      }

      if (sharesUnits <= 0n) {
        res.status(400).json({ error: "shares must be greater than zero" });
        return;
      }

      const resolvedVaultId = typeof vaultId === "number" ? vaultId : undefined;
      const config =
        resolvedVaultId !== undefined ? getVaultConfig(resolvedVaultId) : getPrimaryVaultConfig();

      if (!config) {
        res.status(404).json({ error: "Vault not found" });
        return;
      }

      const userAddress = req.session!.address as string;
      const vaultAddress = config.vaultAddress;

      const existingRequests = await withdrawalRepository.getRequestsByUser(
        userAddress,
        vaultAddress,
      );
      const activeRequest = existingRequests.find(
        (request) =>
          request.status === "pending" ||
          request.status === "ready" ||
          request.status === "settled",
      );

      if (activeRequest) {
        res.status(409).json({
          error: "You already have an active withdrawal request for this vault.",
          requestId: activeRequest.requestId,
          status: activeRequest.status,
          retryable: false,
        });
        return;
      }

      if (config.type === "custom") {
        const lifecycle = (await getCachedLifecycle(config)) as {
          executionMode?: "instant" | "queued" | "blocked";
        };

        if (lifecycle.executionMode === "blocked") {
          res.status(409).json({
            error: "Withdrawals are temporarily blocked until vault telemetry refreshes.",
            retryable: true,
          });
          return;
        }
      }

      const networkConfig = getNetworkConfigFromEnv();
      const publicClient = createPublicClient({
        chain: networkConfig.chain,
        transport: createNetworkTransport(),
      });

      const userShareBalanceRaw = await publicClient.readContract({
        address: vaultAddress as Address,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [userAddress as Address],
      });

      if (sharesUnits > userShareBalanceRaw) {
        res.status(400).json({
          error: "Insufficient vault shares for this withdrawal request.",
          availableShares: formatUnits(userShareBalanceRaw, VAULT_SHARE_DECIMALS),
        });
        return;
      }

      // Get live estimate for initial estimate (share price based)
      const estimate = await estimateRedeemAssets(config, vaultAddress, shares);

      if (estimate.error || estimate.assets <= 0) {
        res.status(503).json({
          error: "Unable to estimate redeemable assets. Please try again.",
          details: estimate.error,
          retryable: true,
        });
        return;
      }

      const liveAssetsEstimated = estimate.assets;
      const normalizedAssetsEstimated = liveAssetsEstimated.toFixed(6);
      const clientAssetsEstimated = assetsEstimated ? parseFloat(assetsEstimated) : null;

      // Log if client estimate differs significantly
      if (
        clientAssetsEstimated !== null &&
        Number.isFinite(clientAssetsEstimated) &&
        Math.abs(clientAssetsEstimated - liveAssetsEstimated) >= 0.01
      ) {
        logger.info("Vault API: Withdrawal estimate differs from client preview", {
          userAddress,
          shares,
          clientAssetsEstimated: clientAssetsEstimated.toFixed(6),
          liveAssetsEstimated: normalizedAssetsEstimated,
          vaultAddress,
        });
      }

      const requestId = `wr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Create initial estimate history entry
      const initialHistoryEntry = {
        timestamp: new Date().toISOString(),
        oldValue: 0,
        newValue: liveAssetsEstimated,
        reason: "initial",
        source: "share_price",
      };

      const request = await withdrawalRepository.createRequest({
        requestId,
        vaultAddress,
        userAddress,
        shares,
        assetsEstimated: normalizedAssetsEstimated,
        estimateHistory: JSON.stringify([initialHistoryEntry]),
      });

      logger.info("Vault API: Withdrawal request queued", {
        requestId,
        userAddress,
        shares,
        assetsEstimated: normalizedAssetsEstimated,
      });

      void activityEventRepository.appendUserVaultActivityEvent({
        vaultId: config.id,
        vaultAddress,
        userAddress,
        eventType: "withdraw_requested",
        title: "Withdrawal requested",
        detail: "Your withdrawal request was submitted.",
        requestId,
        status: request.status,
        assetAmount: normalizedAssetsEstimated,
        shareAmount: shares,
        occurredAt: request.requestedAt,
      });

      res.json({
        success: true,
        requestId: request.requestId,
        status: request.status,
        assetsEstimated: normalizedAssetsEstimated,
        message: "Withdrawal request queued. You will be notified when ready to redeem.",
      });

      // Trigger event-driven reconciliation after withdrawal request creation
      void triggerEventReconciliation(config, "withdrawal_request");
    } catch (error) {
      logger.error("Vault API: Withdrawal request failed", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /vault/withdrawal-queue — get queue status for the current user with repricing
  router.get("/withdrawal-queue", requireAuth, async (req, res) => {
    try {
      const userAddress = req.session!.address as string;
      const vaultAddress = (req.query.vault as string) || env.VAULT_ADDRESS || "";

      let requests = await withdrawalRepository.getRequestsByUser(
        userAddress,
        vaultAddress || undefined,
      );

      requests = await reconcileCustomReadyWithdrawalRequests(userAddress, requests);

      // No live repricing - return requests as-is (no previewRedeem dependency)
      res.json({
        requests,
        total: requests.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get withdrawal queue", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /vault/withdrawal-request/:requestId — get specific request status
  router.get("/withdrawal-request/:requestId", async (req, res) => {
    try {
      const requestId = req.params.requestId!;
      const request = await withdrawalRepository.getRequestById(requestId);

      if (!request) {
        res.status(404).json({ error: "Withdrawal request not found" });
        return;
      }

      res.json({ request });
    } catch (error) {
      logger.error("Vault API: Failed to get withdrawal request", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/withdrawal-request/:requestId/preflight", requireAuth, async (req, res) => {
    const requestId = req.params.requestId!;
    const userAddress = req.session!.address as string;
    const lockKey = `withdrawal-preflight:${requestId}`;
    const vaultId = 0;
    const lockResult = pendingTxRegistry.acquireLock(vaultId, lockKey, "reconcile", "api", {
      ttlMs: 60000,
    });

    if (!lockResult.acquired) {
      res.status(423).json({
        ready: false,
        mode: "queued",
        requestId,
        error: "Concurrent operation in progress. Please retry shortly.",
        retryable: true,
      });
      return;
    }

    try {
      const request = await withdrawalRepository.getRequestById(requestId);
      if (!request) {
        res.status(404).json({ error: "Withdrawal request not found", requestId });
        return;
      }

      if (request.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        res.status(403).json({ error: "Not authorized for this withdrawal request", requestId });
        return;
      }

      if (request.status === "cancelled" || request.status === "completed") {
        res.status(400).json({
          ready: false,
          mode: "queued",
          requestId,
          status: request.status,
          error: `Cannot preflight request in status '${request.status}'`,
        });
        return;
      }

      if (request.status !== "ready") {
        res.status(200).json({
          success: false,
          ready: false,
          mode: "queued",
          requestId,
          status: request.status,
          request,
          reason:
            "Withdrawal is still queued. Worker will mark it ready once liquidity is available.",
        });
        return;
      }

      let requestedAssets: bigint;
      try {
        requestedAssets = parseUnits(request.assetsEstimated, USDC_DECIMALS);
      } catch {
        res.status(503).json({
          ready: false,
          mode: "queued",
          requestId,
          error: "Unable to parse withdrawal estimate for preflight",
          retryable: true,
        });
        return;
      }

      const config = getPrimaryVaultConfig();
      if (request.vaultAddress.toLowerCase() !== config.vaultAddress.toLowerCase()) {
        res.status(400).json({
          ready: false,
          mode: "queued",
          requestId,
          error: "Withdrawal request vault does not match configured vault",
        });
        return;
      }

      const preflight = await new LiquidityManager({ config }).preflightInstantWithdrawal(
        requestedAssets,
      );

      const responseRequest: unknown = request;
      const responseStatus: string = request.status;

      const statusCode = preflight.ready ? 200 : preflight.error ? 503 : 200;

      res.status(statusCode).json({
        success: preflight.ready,
        requestId,
        status: responseStatus,
        request: responseRequest,
        ready: preflight.ready,
        mode: preflight.mode,
        executionMode: preflight.executionMode,
        telemetryFresh: preflight.telemetryFresh,
        liquidityMode: preflight.liquidityMode,
        triggeredRecall: preflight.triggeredRecall,
        requestedAssets: preflight.requestedAssets,
        vaultBalance: preflight.vaultBalance,
        safeBalance: preflight.safeBalance,
        shortfall: preflight.shortfall,
        reason: preflight.reason,
        recallTxHash: preflight.recallTxHash,
        error: preflight.error,
      });
    } catch (error) {
      logger.error("Vault API: Withdrawal instant preflight failed", {
        requestId,
        userAddress,
        error: (error as Error).message,
      });
      res.status(500).json({
        ready: false,
        mode: "queued",
        requestId,
        error: (error as Error).message,
      });
    } finally {
      pendingTxRegistry.releaseLock(vaultId, "reconcile");
    }
  });

  // POST /vault/withdrawal-request/:requestId/cancel — cancel a pending or ready request (idempotent)
  // State Machine: pending|ready → cancelled (idempotent if already cancelled)
  router.post("/withdrawal-request/:requestId/cancel", requireAuth, async (req, res) => {
    const requestId = req.params.requestId!;
    const userAddress = req.session!.address as string;

    // Acquire lock to prevent concurrent state changes
    const lockKey = `withdrawal:${requestId}`;
    const vaultId = 0; // Use 0 as placeholder for withdrawal ops (not vault-specific)
    const lockResult = pendingTxRegistry.acquireLock(
      vaultId,
      lockKey,
      "reconcile", // Using reconcile action for state machine operations
      "api",
      { ttlMs: 30000 }, // 30 second TTL for state transitions
    );

    if (!lockResult.acquired) {
      logger.warn("Vault API: Cancel rejected - concurrent operation in progress", {
        requestId,
        userAddress,
        existingAction: lockResult.existing?.action,
      });
      res.status(423).json({
        error: "Concurrent operation in progress. Please retry shortly.",
        requestId,
        retryable: true,
      });
      return;
    }

    try {
      const existing = await withdrawalRepository.getRequestById(requestId);

      if (!existing) {
        res.status(404).json({ error: "Withdrawal request not found" });
        return;
      }

      if (existing.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        res.status(403).json({ error: "Not authorized to cancel this request" });
        return;
      }

      // Use idempotent state transition (strict state machine)
      // Valid transitions: pending|ready → cancelled
      // Idempotent: cancelled → cancelled returns success with alreadyInTargetState=true
      // Invalid: completed → cancelled, etc. return error
      const result = await withdrawalRepository.markCancelledIdempotent(requestId);

      if (!result.success) {
        const statusCode = result.error?.includes("not found") ? 404 : 400;
        res.status(statusCode).json({
          error: result.error,
          requestId,
          currentStatus: existing.status,
        });
        return;
      }

      // Log idempotency if detected
      if (result.alreadyInTargetState) {
        logger.info("Vault API: Withdrawal cancel - idempotent (already cancelled)", {
          requestId,
          userAddress,
        });
      } else {
        logger.info("Vault API: Withdrawal request cancelled", {
          requestId,
          userAddress,
          previousStatus: existing.status,
        });
      }

      res.json({
        success: true,
        request: result.request,
        idempotent: result.alreadyInTargetState ?? false,
        message: result.alreadyInTargetState
          ? "Withdrawal request was already cancelled"
          : "Withdrawal request cancelled",
      });

      // Trigger event-driven reconciliation after cancellation (only if state changed)
      if (!result.alreadyInTargetState) {
        const config = getPrimaryVaultConfig();
        void activityEventRepository.appendUserVaultActivityEvent({
          vaultId: config.id,
          vaultAddress: existing.vaultAddress,
          userAddress,
          eventType: "withdraw_cancelled",
          title: "Withdrawal cancelled",
          detail: "Your withdrawal request was cancelled.",
          requestId,
          status: result.request?.status ?? "cancelled",
          assetAmount: existing.assetsEstimated,
          shareAmount: existing.shares,
          occurredAt: result.request?.updatedAt ?? new Date(),
        });
        void triggerEventReconciliation(config, "cancel_request");
      }
    } catch (error) {
      logger.error("Vault API: Failed to cancel withdrawal request", {
        requestId,
        userAddress,
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    } finally {
      pendingTxRegistry.releaseLock(vaultId, "reconcile");
    }
  });

  router.post("/withdrawal-request/:requestId/prepare-claim", requireAuth, async (req, res) => {
    const requestId = req.params.requestId!;
    const userAddress = req.session!.address as string;

    // Acquire lock to prevent concurrent state changes
    const lockKey = `withdrawal:${requestId}`;
    const vaultId = 0; // Use 0 as placeholder for withdrawal ops (not vault-specific)
    const lockResult = pendingTxRegistry.acquireLock(
      vaultId,
      lockKey,
      "reconcile", // Using reconcile action for state machine operations
      "api",
      { ttlMs: 30000 }, // 30 second TTL for state transitions
    );

    if (!lockResult.acquired) {
      logger.warn("Vault API: Prepare-claim rejected - concurrent operation in progress", {
        requestId,
        userAddress,
        existingAction: lockResult.existing?.action,
      });
      res.status(423).json({
        error: "Concurrent operation in progress. Please retry shortly.",
        requestId,
        retryable: true,
      });
      return;
    }

    try {
      const existing = await withdrawalRepository.getRequestById(requestId);

      if (!existing) {
        res.status(404).json({ error: "Withdrawal request not found" });
        return;
      }

      if (existing.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        res.status(403).json({ error: "Not authorized to prepare claim for this request" });
        return;
      }

      if (existing.status !== "ready") {
        res.status(409).json({
          error: `Withdrawal ${requestId} is ${existing.status}. Wait for the worker to mark it ready.`,
          requestId,
          currentStatus: existing.status,
          retryable: true,
        });
        return;
      }

      // Use cached estimate from the request (no previewRedeem dependency)
      const cachedEstimate = Number.parseFloat(existing.assetsEstimated);

      if (!Number.isFinite(cachedEstimate) || cachedEstimate <= 0) {
        res.status(503).json({
          error: "Unable to verify claim amount. Please try again.",
          retryable: true,
        });
        return;
      }

      const responseRequest = existing;

      res.json({
        success: true,
        request: responseRequest,
        requestId,
        assetsEstimated: cachedEstimate.toFixed(6),
        slippageWarning: false,
        slippagePercent: 0,
        threshold: DEFAULT_SLIPPAGE_THRESHOLD,
        idempotent: true,
        message: "Withdrawal ready to claim.",
      });
    } catch (error) {
      logger.error("Vault API: Failed to prepare claim", {
        requestId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    } finally {
      pendingTxRegistry.releaseLock(vaultId, "reconcile");
    }
  });

  // POST /vault/withdrawal-request/:requestId/complete — mark request as redeemed (called after on-chain redeem)
  // State Machine: ready → completed (idempotent if already completed)
  router.post("/withdrawal-request/:requestId/complete", requireAuth, async (req, res) => {
    const requestId = req.params.requestId!;
    const { txHash } = req.body as { txHash?: string };
    const userAddress = req.session!.address as string;

    if (!txHash || typeof txHash !== "string" || !txHash.startsWith("0x")) {
      res.status(400).json({ error: "A successful redeem transaction hash is required." });
      return;
    }

    // Acquire lock to prevent concurrent state changes
    const lockKey = `withdrawal:${requestId}`;
    const vaultId = 0; // Use 0 as placeholder for withdrawal ops (not vault-specific)
    const lockResult = pendingTxRegistry.acquireLock(
      vaultId,
      lockKey,
      "reconcile", // Using reconcile action for state machine operations
      "api",
      { ttlMs: 30000 }, // 30 second TTL for state transitions
    );

    if (!lockResult.acquired) {
      logger.warn("Vault API: Complete rejected - concurrent operation in progress", {
        requestId,
        userAddress,
        existingAction: lockResult.existing?.action,
      });
      res.status(423).json({
        error: "Concurrent operation in progress. Please retry shortly.",
        requestId,
        retryable: true,
      });
      return;
    }

    try {
      const existing = await withdrawalRepository.getRequestById(requestId);

      if (!existing) {
        res.status(404).json({ error: "Withdrawal request not found" });
        return;
      }

      if (existing.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        res.status(403).json({ error: "Not authorized to complete this request" });
        return;
      }

      const verification = await verifyWithdrawalCompletionTx({
        txHash: txHash as Hex,
        requestId,
        vaultAddress: existing.vaultAddress,
        userAddress,
        shares: existing.shares,
        readyAt: existing.readyAt,
      });

      if (!verification.valid) {
        res.status(400).json({
          error: verification.error ?? "Unable to verify redeem transaction.",
          requestId,
          currentStatus: existing.status,
        });
        return;
      }

      // Use idempotent state transition (strict state machine)
      // Valid transitions: ready → completed
      // Idempotent: completed → completed returns success with alreadyInTargetState=true
      // Invalid: pending → completed, cancelled → completed, etc. return error
      const result = await withdrawalRepository.markCompletedIdempotent(requestId, txHash);

      if (!result.success) {
        const statusCode = result.error?.includes("not found") ? 404 : 400;
        res.status(statusCode).json({
          error: result.error,
          requestId,
          currentStatus: existing.status,
        });
        return;
      }

      // Log idempotency if detected
      if (result.alreadyInTargetState) {
        logger.info("Vault API: Withdrawal complete - idempotent (already completed)", {
          requestId,
          userAddress,
          txHash,
        });
      } else {
        logger.info("Vault API: Withdrawal request completed", {
          requestId,
          userAddress,
          txHash,
          previousStatus: existing.status,
        });
      }

      res.json({
        success: true,
        request: result.request,
        idempotent: result.alreadyInTargetState ?? false,
        message: result.alreadyInTargetState
          ? "Withdrawal request was already completed"
          : "Withdrawal request marked as completed",
      });

      // Trigger event-driven reconciliation after claim completion (only if state changed)
      if (!result.alreadyInTargetState) {
        const config = getPrimaryVaultConfig();
        void activityEventRepository.appendUserVaultActivityEvent({
          vaultId: config.id,
          vaultAddress: existing.vaultAddress,
          userAddress,
          eventType: "claim_completed",
          title: "Claim completed",
          detail: "Claimed assets from your withdrawal request.",
          requestId,
          txHash,
          status: result.request?.status ?? "completed",
          assetAmount: existing.assetsEstimated,
          shareAmount: existing.shares,
          occurredAt: result.request?.completedAt ?? new Date(),
        });
        void triggerEventReconciliation(config, "claim_completed");
      }
    } catch (error) {
      logger.error("Vault API: Failed to complete withdrawal request", {
        requestId,
        userAddress,
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    } finally {
      pendingTxRegistry.releaseLock(vaultId, "reconcile");
    }
  });

  router.get("/:vaultId/status", async (req, res) => {
    try {
      const rawVaultId = req.params.vaultId;
      if (!rawVaultId) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }
      const vaultId = parseInt(rawVaultId, 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      const oracle = createNavOracle(config);
      const [health, payload] = await Promise.all([
        oracle.getNavHealth(),
        getVaultStatusPayload(config),
      ]);

      res.json({
        vaultId: config.id,
        slug: getVaultSlug(config),
        name: config.name,
        type: config.type,
        enabled: config.enabled,
        profile: getVaultProfile(config),
        mode: payload.mode,
        nav: payload.nav,
        health,
        positionCount: payload.positionCount,
        deployedRatio: payload.deployedRatio,
        committedExposureRatio: payload.committedExposureRatio,
        totalCostBasis: payload.totalCostBasis,
        config: {
          vaultAddress: config.vaultAddress,
          safeAddress: config.safeAddress,
          betSize: config.betSize,
          dailyBudget: config.dailyBudget,
          minOdds: config.minOdds,
          maxOdds: config.maxOdds,
        },
      });
    } catch (error) {
      logger.error("Vault API: Failed to get vault status", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/:vaultId/positions", async (req, res) => {
    try {
      const rawVaultId = req.params.vaultId;
      if (!rawVaultId) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }
      const vaultId = parseInt(rawVaultId, 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      const positions = await getLivePositions(config);

      res.json({
        vaultId: config.id,
        positions,
        total: positions.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get vault positions", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/:vaultId/position-history", async (req, res) => {
    try {
      const rawVaultId = req.params.vaultId;
      if (!rawVaultId) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const vaultId = parseInt(rawVaultId, 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      const positions = await getLivePositionHistory(config);

      res.json({
        vaultId: config.id,
        positions,
        total: positions.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get vault position history", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/:vaultId/nav-history", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId ?? "", 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const snapshots =
        config.type === "custom"
          ? limit !== undefined
            ? await db
                .select({
                  id: navSnapshots.id,
                  navId: navSnapshots.snapshotId,
                  totalAssets: navSnapshots.totalAssets,
                  idleAssets: navSnapshots.totalAssets,
                  deployedCostBasis: navSnapshots.totalAssets,
                  sharePrice: navSnapshots.sharePrice,
                  positionCount: sql<number>`0`.as("position_count"),
                  timestamp: navSnapshots.timestamp,
                  createdAt: navSnapshots.createdAt,
                })
                .from(navSnapshots)
                .where(eq(navSnapshots.vaultAddress, config.vaultAddress))
                .orderBy(desc(navSnapshots.timestamp))
                .limit(limit)
            : await db
                .select({
                  id: navSnapshots.id,
                  navId: navSnapshots.snapshotId,
                  totalAssets: navSnapshots.totalAssets,
                  idleAssets: navSnapshots.totalAssets,
                  deployedCostBasis: navSnapshots.totalAssets,
                  sharePrice: navSnapshots.sharePrice,
                  positionCount: sql<number>`0`.as("position_count"),
                  timestamp: navSnapshots.timestamp,
                  createdAt: navSnapshots.createdAt,
                })
                .from(navSnapshots)
                .where(eq(navSnapshots.vaultAddress, config.vaultAddress))
                .orderBy(desc(navSnapshots.timestamp))
          : await navCalculator.getNavHistory(limit);

      res.json({
        vaultId: config.id,
        snapshots,
        total: snapshots.length,
      });
    } catch (error) {
      logger.error("Vault API: Failed to get vault NAV history", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/:vaultId/scan", requireAuth, async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId ?? "", 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      if (config.type !== "bot") {
        res.status(400).json({ error: "Vault is not a bot vault" });
        return;
      }

      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        res.json({
          success: true,
          vaultId: config.id,
          mode,
          message: "Scan skipped in simulation mode",
          results: [],
        });
        return;
      }
      const pendingWithdrawals = await withdrawalRepository.getPendingRequests(config.vaultAddress);
      if (pendingWithdrawals.length > 0) {
        res.status(409).json({
          success: false,
          error: "Pending withdrawal queue takes priority over new trading",
          pendingWithdrawals: pendingWithdrawals.length,
          vaultId: config.id,
        });
        return;
      }

      const navOracle = createNavOracle(config, undefined, config.id);
      const tradingClient = createVaultTradingClient(config);
      const results = await createTradingOrchestrator(
        config,
        tradingClient,
        navOracle,
      ).runScanCycle();

      res.json({
        success: true,
        vaultId: config.id,
        mode,
        results,
      });
    } catch (error) {
      logger.error("Vault API: Vault scan failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/:vaultId/check-resolutions", requireAuth, async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId ?? "", 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const config = getVaultConfig(vaultId);
      if (!config) {
        res.status(404).json({ error: `Vault ${vaultId} not found` });
        return;
      }

      const mode = getEffectiveMode(config);
      if (mode !== "live") {
        res.json({
          success: true,
          vaultId: config.id,
          mode,
          result: { checked: 0, resolved: 0, won: 0, lost: 0, redeemed: 0, errors: [] },
        });
        return;
      }
      const result = await createResolutionCheckerForConfig(config).checkResolutions();

      res.json({
        success: true,
        vaultId: config.id,
        mode,
        result,
      });
    } catch (error) {
      logger.error("Vault API: Vault resolution check failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Migration status endpoint removed - fresh rollout has no migration
  // GET /vault/migration-status returns 410 Gone for backward compatibility
  router.get("/migration-status", async (_req, res) => {
    res.status(410).json({
      error: "Migration is not available in fresh rollout.",
      message: "Fresh vault deployment - no migration needed.",
    });
  });

  return router;
}
