import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { VaultInstanceConfig } from "../config/types.js";
import {
  getAllVaultConfigs,
  getVaultConfig,
  resolveVaultIdentity,
  type ResolvedVaultIdentity,
} from "../config/index.js";
import { NAV_STALENESS_THRESHOLD, USDC_E_ADDRESS } from "../constants.js";
import { logger } from "../logger.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv } from "../config/network.js";
import {
  PositionRepository,
  positionRepository as defaultPositionRepository,
} from "../repositories/positionRepository.js";
import { epochRepository } from "../repositories/epochRepository.js";
import { activityEventRepository } from "../repositories/activityEventRepository.js";
import { flatBookStateRepository } from "../repositories/flatBookStateRepository.js";
import { navCalculator as defaultNavCalculator, NavCalculator } from "./navCalculator.js";
import {
  positionFetcher as defaultPositionFetcher,
  PositionFetcher,
  type OpenPosition,
} from "./positionFetcher.js";
import { priceService as defaultPriceService, PriceService } from "./priceService.js";
import { DEFAULT_FLATNESS_DUST_THRESHOLD_USDC } from "./flatnessDetector.js";
import { getVaultProvider } from "./vaultProviderFactory.js";
import type { IVaultProvider } from "./vaultProvider.js";
import { derivePendingRedeemFallbackPricing } from "./pendingRedeemPricing.js";

// ===== ABIs =====

const ADAPTER_ABI = [
  {
    type: "function",
    name: "totalPositionCostBasis",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastNavUpdate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "updatePositionValues",
    stateMutability: "nonpayable",
    inputs: [{ name: "newTotalCostBasis", type: "uint256" }],
    outputs: [],
  },
] as const;

/** ABI for NavSnapshot contract - used by custom vaults */
const NAV_SNAPSHOT_ABI = [
  {
    type: "function",
    name: "recordSnapshot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_epochId", type: "uint256" },
      { name: "_totalAssets", type: "uint256" },
      { name: "_totalShares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "latestSnapshot",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "epochId", type: "uint256" },
      { name: "totalAssets", type: "uint256" },
      { name: "totalShares", type: "uint256" },
      { name: "sharePrice", type: "uint256" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "settlementPrecheck",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "epochId", type: "uint256" },
          { name: "totalAssets", type: "uint256" },
          { name: "totalShares", type: "uint256" },
          { name: "sharePrice", type: "uint256" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "STALENESS_THRESHOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** ABI for custom epoch vault - NAV update function */
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
    name: "updateNAV",
    stateMutability: "nonpayable",
    inputs: [{ name: "_nav", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isNAVFresh",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "lastNAVUpdate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "NAV_STALENESS_THRESHOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

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

const VAULT_TOTAL_QUEUED_ASSETS_ABI = [
  {
    type: "function",
    name: "totalQueuedAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_RESERVED_REDEMPTION_ASSETS_ABI = [
  {
    type: "function",
    name: "reservedRedemptionAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_TOTAL_PENDING_REDEEM_SHARES_ABI = [
  {
    type: "function",
    name: "totalPendingRedeemShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_CURRENT_CYCLE_ID_ABI = [
  {
    type: "function",
    name: "currentCycleId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_CYCLES_ABI = [
  {
    type: "function",
    name: "cycles",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "lockedNav", type: "uint256" },
      { name: "totalQueuedDepositAssets", type: "uint256" },
      { name: "totalQueuedRedeemShares", type: "uint256" },
      { name: "totalQueuedRedeemAssets", type: "uint256" },
      { name: "depositCursor", type: "uint256" },
      { name: "redeemCursor", type: "uint256" },
      { name: "processingStartedAt", type: "uint256" },
      { name: "depositsComplete", type: "bool" },
      { name: "redeemsComplete", type: "bool" },
      { name: "finalized", type: "bool" },
    ],
  },
] as const;

const VAULT_TOTAL_CLAIMABLE_REDEEM_ASSETS_ABI = [
  {
    type: "function",
    name: "totalClaimableRedeemAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_CLAIMABLE_DEPOSIT_REQUEST_ABI = [
  {
    type: "function",
    name: "claimableDepositRequest",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ===== Constants =====

const USDC_DECIMALS = 6;
const VAULT_SHARE_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);
const NAV_SCALE = 10n ** 18n;

/** Warn if bid price deviates >30% from cost basis (potential manipulation or stale price) */
const PRICE_DEVIATION_WARN_THRESHOLD = 0.3;

/** Default staleness threshold for custom vaults: 6 hours */
const CUSTOM_VAULT_STALENESS_THRESHOLD = 21600;

// ===== Helpers =====

function decimalToUsdcUnits(value: string | number): bigint {
  const normalized = typeof value === "number" ? value.toFixed(USDC_DECIMALS) : String(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, fractionalPart = ""] = unsigned.split(".");

  const whole = BigInt(wholePart || "0");
  const fraction = BigInt((fractionalPart + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS));
  const units = whole * USDC_SCALE + fraction;

  return negative ? -units : units;
}

function usdcUnitsToDecimalString(value: bigint, decimals: number = USDC_DECIMALS): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(decimals, "0");

  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// ===== Types =====

export interface NavUpdateResult {
  updatedOnChain: boolean;
  oldValue: string;
  newValue: string;
  delta: string;
  txHash?: Hex;
  /** Mark-to-market breakdown (present on successful calculation) */
  marketValue?: {
    totalAssets: number;
    idleAssets: number;
    deployedMarketValue: number;
    deployedCostBasis: number;
    sharePrice: number;
    positionsWithPrices: number;
    positionsWithoutPrices: number;
  };
  /** NAV path used */
  navPath?: "legacy" | "custom";
  /** Epoch ID (for custom vaults) */
  epochId?: number;
}

export interface NavHealth {
  stale: boolean;
  lastUpdateTime: Date;
  secondsSinceUpdate: number;
  thresholdSeconds: number;
  onChainTotalCostBasis: string;
  /** Vault type */
  vaultType?: "legacy" | "custom";
  /** NAV freshness from custom vault */
  navFresh?: boolean;
}

/** NAV snapshot data for custom vaults */
export interface NavSnapshotData {
  epochId: bigint;
  totalAssets: bigint;
  totalShares: bigint;
  sharePrice: bigint;
  timestamp: bigint;
}

export interface LiveNavPreview {
  totalAssets: number;
  trackedTotalAssets: number;
  idleAssets: number;
  deployedMarketValue: number;
  deployedCostBasis: number;
  redeemableMarketValue: number;
  redeemableCostBasis: number;
  sharePrice: number;
  positionsWithPrices: number;
  positionsWithoutPrices: number;
  redeemablePositions: number;
  vaultUsdc: number;
  safeUsdc: number;
  queuedAssets: number;
  claimableDepositAssets: number;
  reservedRedemptionAssets: number;
  totalSupply: number;
  pricingSupply: number;
  totalAssetsUnits: bigint;
  totalSupplyRaw: bigint;
  pricingSupplyRaw: bigint;
  navUnits: bigint;
}

/** Constructor options — accepts either VaultInstanceConfig or individual service overrides */
export interface NavOracleOptions {
  /** Vault config (used to resolve identity and addresses) */
  vaultConfig?: VaultInstanceConfig;
  /** Override position repository (DB-based, used by handleResolution) */
  positions?: PositionRepository;
  /** Override NAV calculator (DB snapshots) */
  navSnapshots?: NavCalculator;
  /** Override price service (CLOB bid prices) */
  prices?: PriceService;
  /** Override position fetcher (Polymarket Data API) */
  fetcher?: PositionFetcher;
  /** Explicitly provide resolved identity (bypasses resolver - for testing only) */
  resolvedIdentity?: ResolvedVaultIdentity;
  /** Vault ID for provider-based vault type detection */
  vaultId?: number;
  /** Force vault type (overrides auto-detection) */
  vaultType?: "legacy" | "custom";
  /** NavSnapshot contract address (for custom vaults) */
  navSnapshotAddress?: Address;
}

// ===== Service =====

export class NavOracleService {
  private readonly adapterAddress: Address | null;
  private readonly vaultAddress: Address;
  private readonly safeAddress: Address;
  private readonly account;
  private readonly publicClient;
  private readonly walletClient;

  /** DB-based position repo — used by handleResolution for position status tracking */
  private readonly positions: PositionRepository;
  /** NAV snapshot recorder */
  private readonly navSnapshots: NavCalculator;
  /** CLOB bid price fetcher */
  private readonly prices: PriceService;
  /** Polymarket Data API position fetcher — source of truth for NAV */
  private readonly fetcher: PositionFetcher;

  /** Vault type: legacy (Morpho) or custom (ERC7540) */
  private readonly vaultType: "legacy" | "custom";

  /** Vault ID for provider access */
  private readonly vaultId: number | null;

  /** Provider instance for custom vault operations */
  private provider: IVaultProvider | null = null;

  /** NavSnapshot contract address for custom vaults */
  private navSnapshotAddress: Address | null = null;

  constructor(options: NavOracleOptions = {}) {
    const config =
      options.vaultConfig ??
      (options.vaultId !== undefined ? getVaultConfig(options.vaultId) : undefined) ??
      getAllVaultConfigs().find((candidate) => candidate.enabled) ??
      getAllVaultConfigs()[0];
    const resolvedIdentity = options.resolvedIdentity;
    const identity = config ? (resolvedIdentity ?? resolveVaultIdentity(config)) : undefined;

    // Resolve addresses and signer key from config + env vars
    let adapterAddress: string | undefined;
    let vaultAddress: string | undefined;
    let safeAddress: string | undefined;
    let privateKey: string | undefined;

    if (identity) {
      vaultAddress = identity.vaultAddress;
      safeAddress = identity.safeAddress;
      privateKey = identity.allocatorNavSignerKey;
    }

    if (!vaultAddress) {
      throw new Error("NavOracleService: vaultAddress is required from vault config");
    }

    if (!safeAddress) {
      throw new Error("NavOracleService: safeAddress is required from vault config");
    }

    if (!privateKey?.startsWith("0x")) {
      throw new Error("NavOracleService: private key is required and must start with 0x");
    }

    this.adapterAddress = adapterAddress ? (adapterAddress as Address) : null;
    this.vaultAddress = vaultAddress as Address;
    this.safeAddress = safeAddress as Address;
    this.account = privateKeyToAccount(privateKey as Hex);

    const networkConfig = getNetworkConfigFromEnv();
    const transport = createNetworkTransport();
    this.publicClient = createPublicClient({
      chain: networkConfig.chain,
      transport,
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: networkConfig.chain,
      transport,
    });

    // Service dependencies
    this.positions = options.positions ?? defaultPositionRepository;
    this.navSnapshots = options.navSnapshots ?? defaultNavCalculator;
    this.prices = options.prices ?? defaultPriceService;
    this.fetcher = options.fetcher ?? defaultPositionFetcher;

    // Determine vault type
    this.vaultId = options.vaultId ?? null;
    const mappedType: "legacy" | "custom" = "custom";
    this.vaultType = options.vaultType ?? mappedType;
    this.navSnapshotAddress = options.navSnapshotAddress ?? null;
    // Initialize provider if vault ID provided
    if (this.vaultId !== null) {
      try {
        this.provider = getVaultProvider(this.vaultId);
        const providerCapabilities = this.provider.getCapabilities();

        // Validate provider type matches expected
        if (!providerCapabilities.epochBased && this.vaultType === "custom") {
          logger.warn(
            "NavOracleService: Provider indicates non-epoch capabilities, keeping custom-only mode",
            {
              vaultId: this.vaultId,
            },
          );
        }
      } catch (error) {
        logger.warn("NavOracleService: Failed to get provider, using configured vaultType", {
          vaultId: this.vaultId,
          vaultType: this.vaultType,
          error: (error as Error).message,
        });
      }
    }

    logger.info("NavOracleService: Initialized", {
      vaultAddress: this.vaultAddress,
      vaultType: this.vaultType,
      vaultId: this.vaultId,
    });
  }

  /** The Safe address this NavOracle monitors */
  getSafeAddress(): string {
    return this.safeAddress;
  }

  /** Get the vault type */
  getVaultType(): "legacy" | "custom" {
    return this.vaultType;
  }

  private getLegacyAdapterAddress(): Address {
    if (!this.adapterAddress) {
      throw new Error("NavOracleService: legacy adapter address is not configured");
    }

    return this.adapterAddress;
  }

  private async readCustomLiabilityState(): Promise<{
    totalQueuedAssetsRaw: bigint;
    claimableDepositAssetsRaw: bigint;
    claimableRedeemAssetsRaw: bigint;
    queuedRedeemAssetsRaw: bigint;
    reservedRedemptionAssetsRaw: bigint;
    totalPendingRedeemSharesRaw: bigint;
  }> {
    const [queuedAssetsDirect, reservedRedemptionDirect, totalPendingRedeemSharesDirect] =
      await Promise.all([
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: VAULT_TOTAL_QUEUED_ASSETS_ABI,
            functionName: "totalQueuedAssets",
          })
          .catch(() => null),
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: VAULT_RESERVED_REDEMPTION_ASSETS_ABI,
            functionName: "reservedRedemptionAssets",
          })
          .catch(() => null),
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: VAULT_TOTAL_PENDING_REDEEM_SHARES_ABI,
            functionName: "totalPendingRedeemShares",
          })
          .catch(() => null),
      ]);

    const claimableRedeemAssetsRaw = await this.publicClient
      .readContract({
        address: this.vaultAddress,
        abi: VAULT_TOTAL_CLAIMABLE_REDEEM_ASSETS_ABI,
        functionName: "totalClaimableRedeemAssets",
      })
      .catch(() => 0n);

    let cycleTotals: {
      totalQueuedDepositAssets: bigint;
      totalQueuedRedeemShares: bigint;
      totalQueuedRedeemAssets: bigint;
    } | null = null;

    const getCycleTotals = async () => {
      if (cycleTotals) {
        return cycleTotals;
      }

      try {
        const currentCycleId = await this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_CURRENT_CYCLE_ID_ABI,
          functionName: "currentCycleId",
        });
        const cycle = await this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_CYCLES_ABI,
          functionName: "cycles",
          args: [currentCycleId],
        });
        cycleTotals = {
          totalQueuedDepositAssets: cycle[1],
          totalQueuedRedeemShares: cycle[2],
          totalQueuedRedeemAssets: cycle[3],
        };
      } catch (error) {
        logger.debug("NavOracleService: Unable to read cycle totals fallback", {
          vaultAddress: this.vaultAddress,
          error: (error as Error).message,
        });
        cycleTotals = {
          totalQueuedDepositAssets: 0n,
          totalQueuedRedeemShares: 0n,
          totalQueuedRedeemAssets: 0n,
        };
      }

      return cycleTotals;
    };

    const totalQueuedAssetsRaw =
      queuedAssetsDirect !== null
        ? queuedAssetsDirect
        : (await getCycleTotals()).totalQueuedDepositAssets;
    const totalPendingRedeemSharesRaw =
      totalPendingRedeemSharesDirect !== null
        ? totalPendingRedeemSharesDirect
        : (await getCycleTotals()).totalQueuedRedeemShares;
    const queuedRedeemAssetsRaw = (await getCycleTotals()).totalQueuedRedeemAssets;
    const reservedRedemptionAssetsRaw =
      reservedRedemptionDirect !== null
        ? reservedRedemptionDirect
        : claimableRedeemAssetsRaw + queuedRedeemAssetsRaw;

    const claimableDepositAssetsRaw = await this.readOutstandingClaimableDepositAssets();

    return {
      totalQueuedAssetsRaw,
      claimableDepositAssetsRaw,
      claimableRedeemAssetsRaw,
      queuedRedeemAssetsRaw,
      reservedRedemptionAssetsRaw,
      totalPendingRedeemSharesRaw,
    };
  }

  private async readOutstandingClaimableDepositAssets(): Promise<bigint> {
    const [participantAddresses, activityAddresses] = await Promise.all([
      flatBookStateRepository.listDepositParticipantAddresses(this.vaultAddress),
      activityEventRepository.listDepositActivityAddresses(this.vaultAddress),
    ]);

    const participantSet = new Set(
      [...participantAddresses, ...activityAddresses].map((address) => address.toLowerCase()),
    );
    const addresses = [...participantSet];

    if (addresses.length === 0) {
      return 0n;
    }

    const claimableAssets = await Promise.all(
      addresses.map((userAddress) =>
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: VAULT_CLAIMABLE_DEPOSIT_REQUEST_ABI,
            functionName: "claimableDepositRequest",
            args: [0n, userAddress as Address],
          })
          .catch(() => 0n),
      ),
    );

    return claimableAssets.reduce((sum, value) => sum + value, 0n);
  }

  /**
   * Mark-to-market NAV calculation and on-chain push.
   *
   * Routes to appropriate implementation based on vault type:
   * - Legacy: Updates Morpho adapter (updatePositionValues)
   * - Custom: Publishes NAV snapshot to custom vault (updateNAV or recordSnapshot)
   */
  async calculateAndPushNav(): Promise<NavUpdateResult> {
    if (this.vaultType === "custom") {
      return this.calculateAndPushNavCustom();
    }
    return this.calculateAndPushNavLegacy();
  }

  async getLiveNavPreview(): Promise<LiveNavPreview> {
    if (this.vaultType !== "custom") {
      throw new Error("NavOracleService: live NAV preview is only supported for custom vaults");
    }

    return this.calculateCustomLiveNavPreview();
  }

  private async calculateCustomLiveNavPreview(): Promise<LiveNavPreview> {
    const networkConfig = getNetworkConfigFromEnv();

    let openPositions: OpenPosition[] = [];
    let redeemablePositions: OpenPosition[] = [];
    if (networkConfig.supportsPolymarketTrading) {
      try {
        [openPositions, redeemablePositions] = await Promise.all([
          this.fetcher.fetchOpenPositions(this.safeAddress),
          this.fetcher.fetchRedeemablePositions(this.safeAddress),
        ]);
      } catch (error) {
        throw new Error(
          `NavOracleService: Failed to fetch live positions for safe ${this.safeAddress}: ${getErrorMessage(error)}`,
        );
      }
    }

    const tokenIds = openPositions.map((p) => p.tokenId);

    let bidPrices = new Map<string, number>();
    if (tokenIds.length > 0) {
      try {
        bidPrices = await this.prices.getBidPrices(tokenIds);
      } catch (error) {
        throw new Error(
          `NavOracleService: Failed to fetch bid prices for ${tokenIds.length} token(s): ${getErrorMessage(error)}`,
        );
      }
    }

    let deployedMarketValue = 0;
    let deployedCostBasis = 0;
    let redeemableMarketValue = 0;
    let redeemableCostBasis = 0;
    let positionsWithPrices = 0;
    let positionsWithoutPrices = 0;

    const actionableOpenPositions = openPositions.filter(
      (position) => position.size > DEFAULT_FLATNESS_DUST_THRESHOLD_USDC,
    );
    const actionableRedeemablePositions = redeemablePositions.filter(
      (position) => position.size > DEFAULT_FLATNESS_DUST_THRESHOLD_USDC,
    );

    const ignoredOpenDustValue = openPositions
      .filter((position) => position.size <= DEFAULT_FLATNESS_DUST_THRESHOLD_USDC)
      .reduce((sum, position) => sum + position.costBasis, 0);
    const ignoredRedeemableDustValue = redeemablePositions
      .filter((position) => position.size <= DEFAULT_FLATNESS_DUST_THRESHOLD_USDC)
      .reduce(
        (sum, position) =>
          sum +
          (typeof position.currentValue === "number" && Number.isFinite(position.currentValue)
            ? position.currentValue
            : position.size),
        0,
      );

    if (ignoredOpenDustValue > 0 || ignoredRedeemableDustValue > 0) {
      logger.info("NavOracleService: Excluding dust Polymarket balances from pricing NAV", {
        vaultId: this.vaultId,
        dustThresholdUsdc: DEFAULT_FLATNESS_DUST_THRESHOLD_USDC,
        ignoredOpenDustValue,
        ignoredRedeemableDustValue,
      });
    }

    for (const position of actionableOpenPositions) {
      const quantity = position.size;
      const costBasis = position.costBasis;
      const bidPrice = bidPrices.get(position.tokenId) ?? 0;

      deployedCostBasis += costBasis;

      if (bidPrice > 0) {
        const marketValue = quantity * bidPrice;
        deployedMarketValue += marketValue;
        positionsWithPrices++;

        const costBasisPerShare = quantity > 0 ? costBasis / quantity : 0;
        if (costBasisPerShare > 0) {
          const deviation = Math.abs(bidPrice - costBasisPerShare) / costBasisPerShare;
          if (deviation > PRICE_DEVIATION_WARN_THRESHOLD) {
            logger.warn("NavOracleService: Large price deviation from cost basis", {
              tokenId: position.tokenId,
              bidPrice,
              costBasisPerShare: costBasisPerShare.toFixed(4),
              deviation: `${(deviation * 100).toFixed(1)}%`,
              title: position.title,
            });
          }
        }
      } else {
        deployedMarketValue += costBasis;
        positionsWithoutPrices++;
        logger.warn("NavOracleService: No bid price, falling back to cost basis", {
          tokenId: position.tokenId,
          costBasis,
          title: position.title,
        });
      }
    }

    for (const position of actionableRedeemablePositions) {
      redeemableCostBasis += position.costBasis;
      redeemableMarketValue +=
        typeof position.currentValue === "number" && Number.isFinite(position.currentValue)
          ? position.currentValue
          : position.size;
    }

    const usdcAddress = USDC_E_ADDRESS as Address;
    const [vaultUsdcRaw, safeUsdcRaw, totalSupplyRaw, liabilityState] = await Promise.all([
      this.publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.vaultAddress],
      }),
      this.publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.safeAddress],
      }),
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: VAULT_TOTAL_SUPPLY_ABI,
        functionName: "totalSupply",
      }),
      this.readCustomLiabilityState(),
    ]);

    const {
      totalQueuedAssetsRaw,
      claimableDepositAssetsRaw,
      claimableRedeemAssetsRaw,
      queuedRedeemAssetsRaw,
      reservedRedemptionAssetsRaw,
      totalPendingRedeemSharesRaw,
    } = liabilityState;

    const queuedAssets = Number(formatUnits(totalQueuedAssetsRaw, USDC_DECIMALS));
    const claimableDepositAssets = Number(formatUnits(claimableDepositAssetsRaw, USDC_DECIMALS));
    const reservedRedemptionAssets = Number(
      formatUnits(reservedRedemptionAssetsRaw, USDC_DECIMALS),
    );
    const vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
    const safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
    const grossIdleAssets = vaultUsdc + safeUsdc;
    const grossTotalAssets = grossIdleAssets + deployedMarketValue + redeemableMarketValue;
    const excludedAssets = queuedAssets + claimableDepositAssets + reservedRedemptionAssets;
    const idleAssets = Math.max(grossIdleAssets - excludedAssets, 0);
    const totalAssets = Math.max(grossTotalAssets - excludedAssets, 0);

    const totalSupply = Number(formatUnits(totalSupplyRaw, USDC_DECIMALS));
    const pricingSupplyRaw =
      totalSupplyRaw > totalPendingRedeemSharesRaw
        ? totalSupplyRaw - totalPendingRedeemSharesRaw
        : 0n;
    const pricingSupply = Number(formatUnits(pricingSupplyRaw, USDC_DECIMALS));
    const pendingRedeemShareCount = Number(formatUnits(totalPendingRedeemSharesRaw, USDC_DECIMALS));
    const grossTotalAssetsUnits = decimalToUsdcUnits(grossTotalAssets);
    const reservedRedemptionUnits = decimalToUsdcUnits(reservedRedemptionAssets);
    const effectiveReservedRedemptionUnits =
      reservedRedemptionUnits < grossTotalAssetsUnits
        ? reservedRedemptionUnits
        : grossTotalAssetsUnits;
    const effectiveReservedRedemptionAssets = Number(
      formatUnits(effectiveReservedRedemptionUnits, USDC_DECIMALS),
    );
    const pendingRedeemFallback = derivePendingRedeemFallbackPricing({
      grossTotalAssetsUnits,
      claimableRedeemAssetsRaw,
      queuedRedeemAssetsRaw,
      effectiveReservedRedemptionUnits,
      totalPendingRedeemSharesRaw,
    });

    if (
      totalPendingRedeemSharesRaw > 0n &&
      effectiveReservedRedemptionUnits < reservedRedemptionUnits
    ) {
      logger.warn("NavOracleService: Capping pending redemption valuation to realizable assets", {
        vaultId: this.vaultId,
        reservedRedemptionAssets,
        realizableAssets: effectiveReservedRedemptionAssets,
        shortfall: reservedRedemptionAssets - effectiveReservedRedemptionAssets,
      });
    }

    if (
      pendingRedeemFallback.usedQueuedRedeemAssets &&
      pendingRedeemFallback.pendingRedeemUnits < queuedRedeemAssetsRaw
    ) {
      logger.warn("NavOracleService: Capping current-cycle queued redemption valuation", {
        vaultId: this.vaultId,
        queuedRedeemAssets: Number(formatUnits(queuedRedeemAssetsRaw, USDC_DECIMALS)),
        realizableAssets: Number(
          formatUnits(pendingRedeemFallback.pendingRedeemUnits, USDC_DECIMALS),
        ),
        shortfall:
          Number(formatUnits(queuedRedeemAssetsRaw, USDC_DECIMALS)) -
          Number(formatUnits(pendingRedeemFallback.pendingRedeemUnits, USDC_DECIMALS)),
      });
    }

    const sharePrice =
      pricingSupply > 0
        ? totalAssets / pricingSupply
        : pendingRedeemShareCount > 0
          ? pendingRedeemFallback.pendingRedeemSharePrice
          : 1.0;
    const totalAssetsUnits = decimalToUsdcUnits(totalAssets);
    const navUnits =
      pricingSupplyRaw > 0n
        ? (totalAssetsUnits * NAV_SCALE) / pricingSupplyRaw
        : totalPendingRedeemSharesRaw > 0n
          ? pendingRedeemFallback.pendingRedeemNavUnits
          : NAV_SCALE;

    return {
      totalAssets,
      trackedTotalAssets: grossTotalAssets,
      idleAssets,
      deployedMarketValue,
      deployedCostBasis,
      redeemableMarketValue,
      redeemableCostBasis,
      sharePrice,
      positionsWithPrices,
      positionsWithoutPrices,
      redeemablePositions: actionableRedeemablePositions.length,
      vaultUsdc,
      safeUsdc,
      queuedAssets,
      claimableDepositAssets,
      reservedRedemptionAssets,
      totalSupply,
      pricingSupply,
      totalAssetsUnits,
      totalSupplyRaw,
      pricingSupplyRaw,
      navUnits,
    };
  }

  /**
   * Legacy (Morpho) NAV calculation and push.
   *
   * 1. Fetch open positions from Polymarket Data API (live source of truth)
   * 2. Batch-fetch bid prices from CLOB API
   * 3. Compute deployedMarketValue = Σ(size × bidPrice)
   *    - Falls back to costBasis if bidPrice is 0 (no liquidity)
   * 4. Read on-chain: vault USDC, safe USDC, totalSupply, adapter state
   * 5. totalAssets = idleAssets + deployedMarketValue
   * 6. sharePrice = totalAssets / totalSupply
   * 7. Push deployedMarketValue to adapter (updatePositionValues)
   * 8. Record NAV snapshot with real values
   */
  private async calculateAndPushNavLegacy(): Promise<NavUpdateResult> {
    // Fetch positions from Polymarket Data API (live, not DB)
    let openPositions;
    try {
      openPositions = await this.fetcher.fetchOpenPositions(this.safeAddress);
    } catch (error) {
      throw new Error(
        `NavOracleService: Failed to fetch open positions for safe ${this.safeAddress}: ${getErrorMessage(error)}`,
      );
    }

    const tokenIds = openPositions.map((p) => p.tokenId);

    let bidPrices = new Map<string, number>();
    if (tokenIds.length > 0) {
      try {
        bidPrices = await this.prices.getBidPrices(tokenIds);
      } catch (error) {
        throw new Error(
          `NavOracleService: Failed to fetch bid prices for ${tokenIds.length} token(s): ${getErrorMessage(error)}`,
        );
      }
    }

    let deployedMarketValue = 0;
    let deployedCostBasis = 0;
    let positionsWithPrices = 0;
    let positionsWithoutPrices = 0;

    for (const position of openPositions) {
      const quantity = position.size;
      const costBasis = position.costBasis;
      const bidPrice = bidPrices.get(position.tokenId) ?? 0;

      deployedCostBasis += costBasis;

      if (bidPrice > 0) {
        const marketValue = quantity * bidPrice;
        deployedMarketValue += marketValue;
        positionsWithPrices++;

        // Warn on large deviations from cost basis (potential manipulation or stale data)
        const costBasisPerShare = quantity > 0 ? costBasis / quantity : 0;
        if (costBasisPerShare > 0) {
          const deviation = Math.abs(bidPrice - costBasisPerShare) / costBasisPerShare;
          if (deviation > PRICE_DEVIATION_WARN_THRESHOLD) {
            logger.warn("NavOracleService: Large price deviation from cost basis", {
              tokenId: position.tokenId,
              bidPrice,
              costBasisPerShare: costBasisPerShare.toFixed(4),
              deviation: `${(deviation * 100).toFixed(1)}%`,
              title: position.title,
            });
          }
        }
      } else {
        // Fallback: use cost basis if no bid price available
        deployedMarketValue += costBasis;
        positionsWithoutPrices++;
        logger.warn("NavOracleService: No bid price, falling back to cost basis", {
          tokenId: position.tokenId,
          costBasis,
          title: position.title,
        });
      }
    }

    const usdcAddress = USDC_E_ADDRESS as Address;

    const [vaultUsdcRaw, safeUsdcRaw, totalSupplyRaw, onChainTotalCostBasis, lastNavUpdate] =
      await Promise.all([
        this.publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [this.vaultAddress],
        }),
        this.publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [this.safeAddress],
        }),
        this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_TOTAL_SUPPLY_ABI,
          functionName: "totalSupply",
        }),
        this.publicClient.readContract({
          address: this.getLegacyAdapterAddress(),
          abi: ADAPTER_ABI,
          functionName: "totalPositionCostBasis",
        }),
        this.publicClient.readContract({
          address: this.getLegacyAdapterAddress(),
          abi: ADAPTER_ABI,
          functionName: "lastNavUpdate",
        }),
      ]);

    const vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
    const safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
    const idleAssets = vaultUsdc + safeUsdc;
    const totalAssets = idleAssets + deployedMarketValue;

    const totalSupply = Number(formatUnits(totalSupplyRaw, USDC_DECIMALS));
    const sharePrice = totalSupply > 0 ? totalAssets / totalSupply : 1.0;

    // Push market value (not cost basis) to adapter — updatePositionValues feeds realAssets()
    const newOnChainValue = decimalToUsdcUnits(deployedMarketValue);
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const secondsSinceUpdate = Math.max(0, nowInSeconds - Number(lastNavUpdate));
    const isStale = secondsSinceUpdate > NAV_STALENESS_THRESHOLD;

    let txHash: Hex | undefined;
    let updatedOnChain = false;

    if (onChainTotalCostBasis !== newOnChainValue || isStale) {
      logger.info("NavOracleService: Pushing on-chain update (Legacy)", {
        reason: onChainTotalCostBasis !== newOnChainValue ? "value_changed" : "stale_timestamp",
        secondsSinceUpdate,
        isStale,
        deployedMarketValue: deployedMarketValue.toFixed(USDC_DECIMALS),
        deployedCostBasis: deployedCostBasis.toFixed(USDC_DECIMALS),
      });

      txHash = await this.walletClient.writeContract({
        address: this.getLegacyAdapterAddress(),
        abi: ADAPTER_ABI,
        functionName: "updatePositionValues",
        args: [newOnChainValue],
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("Legacy NAV update transaction reverted");
      }
      updatedOnChain = true;
    }

    const delta = newOnChainValue - onChainTotalCostBasis;

    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-${Date.now()}-${randomUUID()}`,
      vaultAddress: this.vaultAddress,
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      deployedCostBasis: deployedCostBasis.toFixed(USDC_DECIMALS),
      sharePrice: sharePrice.toFixed(8),
      positionCount: openPositions.length,
    });

    logger.info("NavOracleService: Mark-to-market NAV recalculated (Legacy)", {
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      vaultUsdc: vaultUsdc.toFixed(USDC_DECIMALS),
      safeUsdc: safeUsdc.toFixed(USDC_DECIMALS),
      deployedMarketValue: deployedMarketValue.toFixed(USDC_DECIMALS),
      deployedCostBasis: deployedCostBasis.toFixed(USDC_DECIMALS),
      sharePrice: sharePrice.toFixed(8),
      totalSupply: totalSupply.toFixed(VAULT_SHARE_DECIMALS),
      positionsWithPrices,
      positionsWithoutPrices,
      oldOnChainValue: usdcUnitsToDecimalString(onChainTotalCostBasis),
      newOnChainValue: usdcUnitsToDecimalString(newOnChainValue),
      delta: usdcUnitsToDecimalString(delta),
      txHash,
      updatedOnChain,
      safeAddress: this.safeAddress,
    });

    return {
      updatedOnChain,
      oldValue: usdcUnitsToDecimalString(onChainTotalCostBasis),
      newValue: usdcUnitsToDecimalString(newOnChainValue),
      delta: usdcUnitsToDecimalString(delta),
      txHash,
      navPath: "legacy",
      marketValue: {
        totalAssets,
        idleAssets,
        deployedMarketValue,
        deployedCostBasis,
        sharePrice,
        positionsWithPrices,
        positionsWithoutPrices,
      },
    };
  }

  /**
   * Custom (ERC7540) NAV calculation and snapshot publication.
   *
   * 1. Fetch open positions from Polymarket Data API (live source of truth)
   * 2. Batch-fetch bid prices from CLOB API
   * 3. Compute deployedMarketValue = Σ(size × bidPrice)
   * 4. Read on-chain: vault USDC, safe USDC, totalSupply
   * 5. totalAssets = idleAssets + deployedMarketValue
   * 6. sharePrice = totalAssets / totalSupply
   * 7. Publish NAV snapshot to custom vault (updateNAV or NavSnapshot contract)
   * 8. Store snapshot in DB for settlement reference
   */
  private async calculateAndPushNavCustom(): Promise<NavUpdateResult> {
    const livePreview = await this.calculateCustomLiveNavPreview();

    let cycleId = 0;
    if (this.provider) {
      try {
        const cycleInfo = await this.provider.getBatchStatus();
        cycleId = cycleInfo.batchId;
      } catch (error) {
        logger.warn("NavOracleService: Failed to get cycle info", {
          error: (error as Error).message,
        });
      }
    }

    // Publish NAV snapshot to custom vault
    let txHash: Hex | undefined;
    let updatedOnChain = false;

    try {
      const [currentNavRaw, isFresh] = await Promise.all([
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "currentNAV",
          })
          .catch(() => 0n),
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "isNAVFresh",
          })
          .catch(() => false),
      ]);

      if (livePreview.navUnits !== currentNavRaw || !isFresh) {
        if (this.navSnapshotAddress) {
          txHash = await this.walletClient.writeContract({
            address: this.navSnapshotAddress,
            abi: NAV_SNAPSHOT_ABI,
            functionName: "recordSnapshot",
            args: [BigInt(cycleId), livePreview.totalAssetsUnits, livePreview.totalSupplyRaw],
          });
        } else {
          txHash = await this.walletClient.writeContract({
            address: this.vaultAddress,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "updateNAV",
            args: [livePreview.navUnits],
          });
        }
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
          throw new Error("Custom NAV update transaction reverted");
        }
        updatedOnChain = true;
      }

      logger.info("NavOracleService: Published NAV snapshot (Custom)", {
        cycleId,
        totalAssets: livePreview.totalAssets.toFixed(USDC_DECIMALS),
        totalSupply: livePreview.totalSupply.toFixed(USDC_DECIMALS),
        sharePrice: livePreview.sharePrice.toFixed(8),
        queuedAssets: livePreview.queuedAssets.toFixed(USDC_DECIMALS),
        reservedRedemptionAssets: livePreview.reservedRedemptionAssets.toFixed(USDC_DECIMALS),
        txHash,
        updatedOnChain,
      });
    } catch (error) {
      logger.error("NavOracleService: Failed to publish NAV snapshot", {
        error: (error as Error).message,
        cycleId,
      });
      throw new Error(`Failed to publish NAV snapshot: ${getErrorMessage(error)}`);
    }

    // Record snapshot in DB for settlement reference
    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-custom-${Date.now()}-${randomUUID()}`,
      vaultAddress: this.vaultAddress,
      totalAssets: livePreview.totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: livePreview.idleAssets.toFixed(USDC_DECIMALS),
      deployedCostBasis: livePreview.deployedCostBasis.toFixed(USDC_DECIMALS),
      sharePrice: livePreview.sharePrice.toFixed(8),
      positionCount: livePreview.positionsWithPrices + livePreview.positionsWithoutPrices,
    });

    try {
      await epochRepository.createNavSnapshot({
        snapshotId: `nav-cycle-${cycleId}-${Date.now()}`,
        epochId: cycleId.toString(),
        vaultAddress: this.vaultAddress,
        totalAssets: livePreview.totalAssets.toFixed(USDC_DECIMALS),
        totalShares: livePreview.totalSupply.toFixed(USDC_DECIMALS),
        sharePrice: livePreview.sharePrice.toFixed(8),
        timestamp: new Date(),
        recordedBy: this.account.address,
        txHash,
      });
    } catch (error) {
      logger.warn("NavOracleService: Failed to record cycle NAV snapshot", {
        error: (error as Error).message,
        cycleId,
      });
    }

    return {
      updatedOnChain,
      oldValue: "0", // Custom vaults don't track delta the same way
      newValue: livePreview.totalAssets.toFixed(USDC_DECIMALS),
      delta: livePreview.totalAssets.toFixed(USDC_DECIMALS),
      txHash,
      navPath: "custom",
      epochId: cycleId,
      marketValue: {
        totalAssets: livePreview.totalAssets,
        idleAssets: livePreview.idleAssets,
        deployedMarketValue: livePreview.deployedMarketValue,
        deployedCostBasis: livePreview.deployedCostBasis,
        sharePrice: livePreview.sharePrice,
        positionsWithPrices: livePreview.positionsWithPrices,
        positionsWithoutPrices: livePreview.positionsWithoutPrices,
      },
    };
  }

  /**
   * Handle a resolved position — update DB status and recalculate NAV.
   * Works for both legacy and custom vaults.
   */
  async handleResolution(positionId: number, isWin: boolean): Promise<NavUpdateResult> {
    const position = await this.positions.getPositionById(positionId);

    if (!position) {
      throw new Error(`NavOracleService: Position ${positionId} not found`);
    }

    if (position.status !== "open") {
      throw new Error(`NavOracleService: Position ${positionId} is not open`);
    }

    const quantity = decimalToUsdcUnits(position.quantity);
    const costBasis = decimalToUsdcUnits(position.costBasis);

    const resolvedPnl = isWin ? quantity - costBasis : -costBasis;
    const status = isWin ? "resolved_win" : "resolved_loss";

    await this.positions.updatePositionStatus(
      positionId,
      status,
      usdcUnitsToDecimalString(resolvedPnl),
    );

    return this.calculateAndPushNav();
  }

  /**
   * Get NAV health status.
   * Routes to appropriate implementation based on vault type.
   */
  async getNavHealth(): Promise<NavHealth> {
    if (this.vaultType === "custom") {
      return this.getNavHealthCustom();
    }
    return this.getNavHealthLegacy();
  }

  /**
   * Legacy (Morpho) NAV health.
   */
  private async getNavHealthLegacy(): Promise<NavHealth> {
    const [lastNavUpdate, onChainTotalCostBasis] = await Promise.all([
      this.publicClient.readContract({
        address: this.getLegacyAdapterAddress(),
        abi: ADAPTER_ABI,
        functionName: "lastNavUpdate",
      }),
      this.publicClient.readContract({
        address: this.getLegacyAdapterAddress(),
        abi: ADAPTER_ABI,
        functionName: "totalPositionCostBasis",
      }),
    ]);

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const lastUpdateSeconds = Number(lastNavUpdate);
    const secondsSinceUpdate = Math.max(0, nowInSeconds - lastUpdateSeconds);

    return {
      stale: secondsSinceUpdate > NAV_STALENESS_THRESHOLD,
      lastUpdateTime: new Date(lastUpdateSeconds * 1000),
      secondsSinceUpdate,
      thresholdSeconds: NAV_STALENESS_THRESHOLD,
      onChainTotalCostBasis: usdcUnitsToDecimalString(onChainTotalCostBasis),
      vaultType: "legacy",
    };
  }

  /**
   * Custom (ERC7540) NAV health.
   */
  private async getNavHealthCustom(): Promise<NavHealth> {
    try {
      // Try to get freshness from vault contract
      const [lastNAVUpdate, isFresh, threshold] = await Promise.all([
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "lastNAVUpdate",
          })
          .catch(() => 0n),
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "isNAVFresh",
          })
          .catch(() => false),
        this.publicClient
          .readContract({
            address: this.vaultAddress,
            abi: CUSTOM_VAULT_NAV_ABI,
            functionName: "NAV_STALENESS_THRESHOLD",
          })
          .catch(() => BigInt(CUSTOM_VAULT_STALENESS_THRESHOLD)),
      ]);

      const nowInSeconds = Math.floor(Date.now() / 1000);
      const lastUpdateSeconds = Number(lastNAVUpdate);
      const secondsSinceUpdate = Math.max(0, nowInSeconds - lastUpdateSeconds);
      const thresholdSeconds = Number(threshold);

      return {
        stale: !isFresh,
        lastUpdateTime: new Date(lastUpdateSeconds * 1000),
        secondsSinceUpdate,
        thresholdSeconds,
        onChainTotalCostBasis: "0", // Not applicable for custom vaults
        vaultType: "custom",
        navFresh: isFresh,
      };
    } catch (error) {
      logger.warn("NavOracleService: Failed to get custom NAV health", {
        error: (error as Error).message,
      });

      // Fallback to stale
      return {
        stale: true,
        lastUpdateTime: new Date(0),
        secondsSinceUpdate: Infinity,
        thresholdSeconds: CUSTOM_VAULT_STALENESS_THRESHOLD,
        onChainTotalCostBasis: "0",
        vaultType: "custom",
        navFresh: false,
      };
    }
  }

  /**
   * Force a NAV update with a specific value. Used for admin corrections.
   * Routes to appropriate implementation based on vault type.
   */
  async forceNavUpdate(newValue: string | number, adminSecret?: string): Promise<NavUpdateResult> {
    const requiredAdminSecret = process.env.NAV_ORACLE_ADMIN_SECRET;
    if (requiredAdminSecret && adminSecret !== requiredAdminSecret) {
      throw new Error("NavOracleService: unauthorized forceNavUpdate call");
    }

    if (this.vaultType === "custom") {
      return this.forceNavUpdateCustom(newValue);
    }
    return this.forceNavUpdateLegacy(newValue);
  }

  /**
   * Legacy (Morpho) force NAV update.
   */
  private async forceNavUpdateLegacy(newValue: string | number): Promise<NavUpdateResult> {
    const usdcAddress = USDC_E_ADDRESS as Address;

    const [currentOnChainValue, vaultUsdcRaw, safeUsdcRaw, totalSupplyRaw] = await Promise.all([
      this.publicClient.readContract({
        address: this.getLegacyAdapterAddress(),
        abi: ADAPTER_ABI,
        functionName: "totalPositionCostBasis",
      }),
      this.publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.vaultAddress],
      }),
      this.publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.safeAddress],
      }),
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: VAULT_TOTAL_SUPPLY_ABI,
        functionName: "totalSupply",
      }),
    ]);

    const forcedValue = decimalToUsdcUnits(newValue);

    const txHash = await this.walletClient.writeContract({
      address: this.getLegacyAdapterAddress(),
      abi: ADAPTER_ABI,
      functionName: "updatePositionValues",
      args: [forcedValue],
    });

    // Use Data API for position count (live source of truth)
    const openPositions = await this.fetcher.fetchOpenPositions(this.safeAddress);

    const vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
    const safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
    const idleAssets = vaultUsdc + safeUsdc;
    const forcedDecimal = Number(usdcUnitsToDecimalString(forcedValue));
    const totalAssets = idleAssets + forcedDecimal;
    const totalSupply = Number(formatUnits(totalSupplyRaw, VAULT_SHARE_DECIMALS));
    const sharePrice = totalSupply > 0 ? totalAssets / totalSupply : 1.0;

    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-force-${Date.now()}-${randomUUID()}`,
      vaultAddress: this.vaultAddress,
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      deployedCostBasis: usdcUnitsToDecimalString(forcedValue),
      sharePrice: sharePrice.toFixed(8),
      positionCount: openPositions.length,
    });

    const delta = forcedValue - currentOnChainValue;

    logger.warn("NavOracleService: Force NAV update executed (Legacy)", {
      oldValue: usdcUnitsToDecimalString(currentOnChainValue),
      newValue: usdcUnitsToDecimalString(forcedValue),
      delta: usdcUnitsToDecimalString(delta),
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      sharePrice: sharePrice.toFixed(8),
      txHash,
    });

    return {
      updatedOnChain: true,
      oldValue: usdcUnitsToDecimalString(currentOnChainValue),
      newValue: usdcUnitsToDecimalString(forcedValue),
      delta: usdcUnitsToDecimalString(delta),
      txHash,
      navPath: "legacy",
    };
  }

  /**
   * Custom (ERC7540) force NAV update.
   */
  private async forceNavUpdateCustom(newValue: string | number): Promise<NavUpdateResult> {
    const usdcAddress = USDC_E_ADDRESS as Address;

    const [vaultUsdcRaw, safeUsdcRaw, totalSupplyRaw, liabilityState] = await Promise.all([
      this.publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.vaultAddress],
      }),
      this.publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [this.safeAddress],
      }),
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: VAULT_TOTAL_SUPPLY_ABI,
        functionName: "totalSupply",
      }),
      this.readCustomLiabilityState(),
    ]);

    const {
      totalQueuedAssetsRaw,
      claimableDepositAssetsRaw,
      claimableRedeemAssetsRaw,
      queuedRedeemAssetsRaw,
      reservedRedemptionAssetsRaw,
      totalPendingRedeemSharesRaw,
    } = liabilityState;

    const forcedValue = decimalToUsdcUnits(newValue);
    const pricingSupplyRaw =
      totalSupplyRaw > totalPendingRedeemSharesRaw
        ? totalSupplyRaw - totalPendingRedeemSharesRaw
        : 0n;

    const vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
    const queuedAssets = Number(formatUnits(totalQueuedAssetsRaw, USDC_DECIMALS));
    const claimableDepositAssets = Number(formatUnits(claimableDepositAssetsRaw, USDC_DECIMALS));
    const reservedRedemptionAssets = Number(
      formatUnits(reservedRedemptionAssetsRaw, USDC_DECIMALS),
    );
    const safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
    const grossIdleAssets = vaultUsdc + safeUsdc;
    const excludedAssets = queuedAssets + claimableDepositAssets + reservedRedemptionAssets;
    const idleAssets = Math.max(grossIdleAssets - excludedAssets, 0);
    const forcedDecimal = Number(usdcUnitsToDecimalString(forcedValue));
    const totalAssets = idleAssets + forcedDecimal;
    const totalAssetsUnits = decimalToUsdcUnits(totalAssets);
    const grossTotalAssetsUnits = totalAssetsUnits + decimalToUsdcUnits(excludedAssets);
    const pricingSupply = Number(formatUnits(pricingSupplyRaw, USDC_DECIMALS));
    const pendingRedeemShareCount = Number(formatUnits(totalPendingRedeemSharesRaw, USDC_DECIMALS));
    const effectiveReservedRedemptionUnits =
      reservedRedemptionAssetsRaw < grossTotalAssetsUnits
        ? reservedRedemptionAssetsRaw
        : grossTotalAssetsUnits;
    const pendingRedeemFallback = derivePendingRedeemFallbackPricing({
      grossTotalAssetsUnits,
      claimableRedeemAssetsRaw,
      queuedRedeemAssetsRaw,
      effectiveReservedRedemptionUnits,
      totalPendingRedeemSharesRaw,
    });
    const forcedNavUnits =
      pricingSupplyRaw > 0n
        ? (forcedValue * NAV_SCALE) / pricingSupplyRaw
        : totalPendingRedeemSharesRaw > 0n
          ? pendingRedeemFallback.pendingRedeemNavUnits
          : NAV_SCALE;

    let txHash: Hex;
    if (this.navSnapshotAddress) {
      // Use NavSnapshot contract
      const epochId = 0; // Force update uses epoch 0
      txHash = await this.walletClient.writeContract({
        address: this.navSnapshotAddress,
        abi: NAV_SNAPSHOT_ABI,
        functionName: "recordSnapshot",
        args: [BigInt(epochId), forcedValue, pricingSupplyRaw],
      });
    } else {
      // Use vault's updateNAV function
      txHash = await this.walletClient.writeContract({
        address: this.vaultAddress,
        abi: CUSTOM_VAULT_NAV_ABI,
        functionName: "updateNAV",
        args: [forcedNavUnits],
      });
    }
    const sharePrice =
      pricingSupply > 0
        ? totalAssets / pricingSupply
        : pendingRedeemShareCount > 0
          ? pendingRedeemFallback.pendingRedeemSharePrice
          : 1.0;

    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-force-custom-${Date.now()}-${randomUUID()}`,
      vaultAddress: this.vaultAddress,
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      deployedCostBasis: usdcUnitsToDecimalString(forcedValue),
      sharePrice: sharePrice.toFixed(8),
      positionCount: 0,
    });

    try {
      await epochRepository.createNavSnapshot({
        snapshotId: `nav-force-cycle-0-${Date.now()}`,
        epochId: "0",
        vaultAddress: this.vaultAddress,
        totalAssets: totalAssets.toFixed(USDC_DECIMALS),
        totalShares: pricingSupply.toFixed(USDC_DECIMALS),
        sharePrice: sharePrice.toFixed(8),
        timestamp: new Date(),
        recordedBy: this.account.address,
        txHash,
      });
    } catch (error) {
      logger.warn("NavOracleService: Failed to record forced custom NAV snapshot", {
        error: (error as Error).message,
      });
    }

    logger.warn("NavOracleService: Force NAV update executed (Custom)", {
      newValue: usdcUnitsToDecimalString(forcedValue),
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      vaultUsdc: vaultUsdc.toFixed(USDC_DECIMALS),
      queuedAssets: queuedAssets.toFixed(USDC_DECIMALS),
      claimableDepositAssets: claimableDepositAssets.toFixed(USDC_DECIMALS),
      reservedRedemptionAssets: reservedRedemptionAssets.toFixed(USDC_DECIMALS),
      sharePrice: sharePrice.toFixed(8),
      txHash,
    });

    return {
      updatedOnChain: true,
      oldValue: "0",
      newValue: usdcUnitsToDecimalString(forcedValue),
      delta: usdcUnitsToDecimalString(forcedValue),
      txHash,
      navPath: "custom",
    };
  }
}

/**
 * Create a NavOracleService for a specific vault config.
 * Use this for multi-vault support.
 *
 * @param config - The vault instance configuration
 * @param resolvedIdentity - Optional pre-resolved identity (bypasses resolver)
 * @param vaultId - Optional vault ID for provider access
 */
export function createNavOracle(
  config: VaultInstanceConfig,
  resolvedIdentity?: ResolvedVaultIdentity,
  vaultId?: number,
): NavOracleService {
  return new NavOracleService({ vaultConfig: config, resolvedIdentity, vaultId });
}

let defaultNavOracleInstance: NavOracleService | null = null;

export function getDefaultNavOracle(): NavOracleService {
  if (!defaultNavOracleInstance) {
    defaultNavOracleInstance = new NavOracleService();
  }

  return defaultNavOracleInstance;
}

export const navOracle: Pick<
  NavOracleService,
  "calculateAndPushNav" | "getNavHealth" | "forceNavUpdate" | "handleResolution"
> = {
  calculateAndPushNav: () => getDefaultNavOracle().calculateAndPushNav(),
  getNavHealth: () => getDefaultNavOracle().getNavHealth(),
  forceNavUpdate: (newValue, adminSecret) =>
    getDefaultNavOracle().forceNavUpdate(newValue, adminSecret),
  handleResolution: (positionId, isWin) =>
    getDefaultNavOracle().handleResolution(positionId, isWin),
};
