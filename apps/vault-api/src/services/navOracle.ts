import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { VaultInstanceConfig } from "../config/types.js";
import { resolveVaultIdentity, type ResolvedVaultIdentity } from "../config/identityResolver.js";
import { NAV_STALENESS_THRESHOLD, USDC_E_ADDRESS } from "../constants.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv } from "../config/network.js";
import {
  PositionRepository,
  positionRepository as defaultPositionRepository,
} from "../repositories/positionRepository.js";
import { epochRepository } from "../repositories/epochRepository.js";
import { navCalculator as defaultNavCalculator, NavCalculator } from "./navCalculator.js";
import {
  positionFetcher as defaultPositionFetcher,
  PositionFetcher,
  type OpenPosition,
} from "./positionFetcher.js";
import { priceService as defaultPriceService, PriceService } from "./priceService.js";
import { getVaultProvider } from "./vaultProviderFactory.js";
import type { IVaultProvider } from "./vaultProvider.js";

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
    const config = options.vaultConfig;
    const resolvedIdentity = options.resolvedIdentity;

    // Resolve addresses and signer key from config + env vars
    let adapterAddress: string | undefined;
    let vaultAddress: string | undefined;
    let safeAddress: string | undefined;
    let privateKey: string | undefined;

    if (config) {
      // Use identity resolver to get actual key values from env vars
      const identity = resolvedIdentity ?? resolveVaultIdentity(config);
      vaultAddress = identity.vaultAddress;
      safeAddress = identity.safeAddress;
      privateKey = identity.allocatorNavSignerKey;
    } else {
      adapterAddress = undefined;
      vaultAddress = env.VAULT_ADDRESS;
      safeAddress = env.SAFE_ADDRESS;
      // No fallback for private key - must be provided via config
    }

    if (!vaultAddress) {
      throw new Error("NavOracleService: vaultAddress is required (config or VAULT_ADDRESS env)");
    }

    if (!safeAddress) {
      throw new Error("NavOracleService: safeAddress is required (config or SAFE_ADDRESS env)");
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
    this.vaultType = options.vaultType === "legacy" ? "custom" : (options.vaultType ?? mappedType);
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
      updatedOnChain = true;
    }

    const delta = newOnChainValue - onChainTotalCostBasis;

    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-${Date.now()}-${randomUUID()}`,
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
    const networkConfig = getNetworkConfigFromEnv();

    let openPositions: OpenPosition[] = [];
    if (networkConfig.supportsPolymarketTrading) {
      try {
        openPositions = await this.fetcher.fetchOpenPositions(this.safeAddress);
      } catch (error) {
        throw new Error(
          `NavOracleService: Failed to fetch open positions for safe ${this.safeAddress}: ${getErrorMessage(error)}`,
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

        // Warn on large deviations
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

    const usdcAddress = USDC_E_ADDRESS as Address;

    // Read on-chain balances
    const [
      vaultUsdcRaw,
      safeUsdcRaw,
      totalSupplyRaw,
      totalQueuedAssetsRaw,
      reservedRedemptionAssetsRaw,
      totalPendingRedeemSharesRaw,
    ] = await Promise.all([
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
        address: this.vaultAddress,
        abi: VAULT_TOTAL_QUEUED_ASSETS_ABI,
        functionName: "totalQueuedAssets",
      }),
      this.publicClient
        .readContract({
          address: this.vaultAddress,
          abi: VAULT_RESERVED_REDEMPTION_ASSETS_ABI,
          functionName: "reservedRedemptionAssets",
        })
        .catch(() => 0n),
      this.publicClient
        .readContract({
          address: this.vaultAddress,
          abi: VAULT_TOTAL_PENDING_REDEEM_SHARES_ABI,
          functionName: "totalPendingRedeemShares",
        })
        .catch(() => 0n),
    ]);

    const queuedAssets = Number(formatUnits(totalQueuedAssetsRaw, USDC_DECIMALS));
    const reservedRedemptionAssets = Number(
      formatUnits(reservedRedemptionAssetsRaw, USDC_DECIMALS),
    );
    const vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
    const safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
    const grossIdleAssets = vaultUsdc + safeUsdc;
    const grossTotalAssets = grossIdleAssets + deployedMarketValue;
    const excludedAssets = queuedAssets + reservedRedemptionAssets;
    const idleAssets = Math.max(grossIdleAssets - excludedAssets, 0);
    const totalAssets = Math.max(grossTotalAssets - excludedAssets, 0);

    const totalSupply = Number(formatUnits(totalSupplyRaw, USDC_DECIMALS));
    const pricingSupplyRaw = totalSupplyRaw + totalPendingRedeemSharesRaw;
    const pricingSupply = Number(formatUnits(pricingSupplyRaw, USDC_DECIMALS));
    const sharePrice = pricingSupply > 0 ? totalAssets / pricingSupply : 1.0;

    // Convert to on-chain units
    const totalAssetsUnits = decimalToUsdcUnits(totalAssets);
    const navUnits =
      pricingSupplyRaw > 0n ? (totalAssetsUnits * NAV_SCALE) / pricingSupplyRaw : NAV_SCALE;

    // Get current epoch info from provider if available
    let epochId = 0;
    if (this.provider) {
      try {
        const epochInfo = await this.provider.getEpochStatus();
        epochId = epochInfo.epochId;
      } catch (error) {
        logger.warn("NavOracleService: Failed to get epoch info", {
          error: (error as Error).message,
        });
      }
    }

    // Publish NAV snapshot to custom vault
    let txHash: Hex | undefined;
    let updatedOnChain = false;

    try {
      if (this.navSnapshotAddress) {
        // Use NavSnapshot contract
        txHash = await this.walletClient.writeContract({
          address: this.navSnapshotAddress,
          abi: NAV_SNAPSHOT_ABI,
          functionName: "recordSnapshot",
          args: [BigInt(epochId), totalAssetsUnits, totalSupplyRaw],
        });
      } else {
        // Use vault's updateNAV function directly
        txHash = await this.walletClient.writeContract({
          address: this.vaultAddress,
          abi: CUSTOM_VAULT_NAV_ABI,
          functionName: "updateNAV",
          args: [navUnits],
        });
      }
      updatedOnChain = true;

      logger.info("NavOracleService: Published NAV snapshot (Custom)", {
        epochId,
        totalAssets: totalAssets.toFixed(USDC_DECIMALS),
        totalSupply: totalSupply.toFixed(USDC_DECIMALS),
        sharePrice: sharePrice.toFixed(8),
        queuedAssets: queuedAssets.toFixed(USDC_DECIMALS),
        reservedRedemptionAssets: reservedRedemptionAssets.toFixed(USDC_DECIMALS),
        txHash,
      });
    } catch (error) {
      logger.error("NavOracleService: Failed to publish NAV snapshot", {
        error: (error as Error).message,
        epochId,
      });
      throw new Error(`Failed to publish NAV snapshot: ${getErrorMessage(error)}`);
    }

    // Record snapshot in DB for settlement reference
    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-custom-${Date.now()}-${randomUUID()}`,
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      deployedCostBasis: deployedCostBasis.toFixed(USDC_DECIMALS),
      sharePrice: sharePrice.toFixed(8),
      positionCount: openPositions.length,
    });

    // Also create epoch NAV snapshot if we have an epoch ID
    if (epochId > 0) {
      try {
        await epochRepository.createNavSnapshot({
          snapshotId: `nav-epoch-${epochId}-${Date.now()}`,
          epochId: epochId.toString(),
          vaultAddress: this.vaultAddress,
          totalAssets: totalAssets.toFixed(USDC_DECIMALS),
          totalShares: totalSupply.toFixed(USDC_DECIMALS),
          sharePrice: sharePrice.toFixed(8),
          timestamp: new Date(),
          recordedBy: this.account.address,
          txHash,
        });
      } catch (error) {
        logger.warn("NavOracleService: Failed to record epoch NAV snapshot", {
          error: (error as Error).message,
          epochId,
        });
      }
    }

    return {
      updatedOnChain,
      oldValue: "0", // Custom vaults don't track delta the same way
      newValue: totalAssets.toFixed(USDC_DECIMALS),
      delta: totalAssets.toFixed(USDC_DECIMALS),
      txHash,
      navPath: "custom",
      epochId,
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

    const [
      vaultUsdcRaw,
      safeUsdcRaw,
      totalSupplyRaw,
      totalQueuedAssetsRaw,
      reservedRedemptionAssetsRaw,
      totalPendingRedeemSharesRaw,
    ] = await Promise.all([
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
        address: this.vaultAddress,
        abi: VAULT_TOTAL_QUEUED_ASSETS_ABI,
        functionName: "totalQueuedAssets",
      }),
      this.publicClient
        .readContract({
          address: this.vaultAddress,
          abi: VAULT_RESERVED_REDEMPTION_ASSETS_ABI,
          functionName: "reservedRedemptionAssets",
        })
        .catch(() => 0n),
      this.publicClient
        .readContract({
          address: this.vaultAddress,
          abi: VAULT_TOTAL_PENDING_REDEEM_SHARES_ABI,
          functionName: "totalPendingRedeemShares",
        })
        .catch(() => 0n),
    ]);

    const forcedValue = decimalToUsdcUnits(newValue);
    const pricingSupplyRaw = totalSupplyRaw + totalPendingRedeemSharesRaw;
    const forcedNavUnits =
      pricingSupplyRaw > 0n ? (forcedValue * NAV_SCALE) / pricingSupplyRaw : NAV_SCALE;

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

    const vaultUsdc = Number(formatUnits(vaultUsdcRaw, USDC_DECIMALS));
    const queuedAssets = Number(formatUnits(totalQueuedAssetsRaw, USDC_DECIMALS));
    const reservedRedemptionAssets = Number(
      formatUnits(reservedRedemptionAssetsRaw, USDC_DECIMALS),
    );
    const safeUsdc = Number(formatUnits(safeUsdcRaw, USDC_DECIMALS));
    const grossIdleAssets = vaultUsdc + safeUsdc;
    const excludedAssets = queuedAssets + reservedRedemptionAssets;
    const idleAssets = Math.max(grossIdleAssets - excludedAssets, 0);
    const forcedDecimal = Number(usdcUnitsToDecimalString(forcedValue));
    const totalAssets = idleAssets + forcedDecimal;
    const pricingSupply = Number(formatUnits(pricingSupplyRaw, USDC_DECIMALS));
    const sharePrice = pricingSupply > 0 ? totalAssets / pricingSupply : 1.0;

    await this.navSnapshots.recordNavSnapshot({
      navId: `nav-force-custom-${Date.now()}-${randomUUID()}`,
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      deployedCostBasis: usdcUnitsToDecimalString(forcedValue),
      sharePrice: sharePrice.toFixed(8),
      positionCount: 0,
    });

    logger.warn("NavOracleService: Force NAV update executed (Custom)", {
      newValue: usdcUnitsToDecimalString(forcedValue),
      totalAssets: totalAssets.toFixed(USDC_DECIMALS),
      idleAssets: idleAssets.toFixed(USDC_DECIMALS),
      vaultUsdc: vaultUsdc.toFixed(USDC_DECIMALS),
      queuedAssets: queuedAssets.toFixed(USDC_DECIMALS),
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
