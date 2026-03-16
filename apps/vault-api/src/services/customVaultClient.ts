import type { Address, Hex, WalletClient } from "viem";
import { createPublicClient, http } from "viem";
import type { Chain } from "viem/chains";
import { logger } from "../logger.js";

export type BatchStatus =
  | "open"
  | "cutoff"
  | "flattening"
  | "settling"
  | "settled"
  | "closed"
  | "reopen"
  | "processing"
  | "processed";

export type RedemptionStatus = "pending" | "escrowed" | "claimable" | "claimed" | "cancelled";

export interface BatchData {
  batchId: bigint;
  startTime: bigint;
  endTime: bigint;
  cutoffTime: bigint;
  snapshotNAV: bigint;
  lockedClearingPrice: bigint;
  snapshotTimestamp: bigint;
  totalSharesPending: bigint;
  totalAssetsSnapshot: bigint;
  proRataRatio: bigint;
  totalQueuedDeposits: bigint;
  status: BatchStatus;
  isPriceLocked: boolean;
  exists?: boolean;
}

export interface SettlementProgressData {
  processed: bigint;
  total: bigint;
  lastIndex: bigint;
  reservedAssetsAllocated: bigint;
  isComplete: boolean;
}

export interface RedemptionRequestData {
  requestId: bigint;
  controller: Address;
  owner: Address;
  shares: bigint;
  assetsClaimable: bigint;
  batchId: bigint;
  status: RedemptionStatus;
  createdAt: bigint;
  settledAt: bigint;
}

export interface EpochData {
  epochId: bigint;
  startTime: bigint;
  endTime: bigint;
  settlementTime: bigint;
  totalRequests: number;
  totalShares: bigint;
  settled: boolean;
  proRataRatio?: bigint;
  availableAssets?: bigint;
}

export interface VaultContractConfig {
  deployTime: bigint;
  navStalenessThreshold: bigint;
}

export interface NAVStatus {
  currentNAV: bigint;
  lastNAVUpdate: bigint;
  isFresh: boolean;
}

interface CycleData {
  lockedNav: bigint;
  totalQueuedDepositAssets: bigint;
  totalQueuedRedeemShares: bigint;
  totalQueuedRedeemAssets: bigint;
  depositCursor: bigint;
  redeemCursor: bigint;
  processingStartedAt: bigint;
  depositsComplete: boolean;
  redeemsComplete: boolean;
  finalized: boolean;
}

interface TxResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
}

export interface DepositRequestData {
  requestId: bigint;
  depositor: Address;
  assets: bigint;
  targetBatch: bigint;
  createdAt: bigint;
  status: "pending" | "processed" | "cancelled";
}

export const FLAT_BOOK_VAULT_V2_ABI = [
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidState",
    inputs: [
      { type: "uint8", name: "expected" },
      { type: "uint8", name: "actual" },
    ],
  },
  {
    type: "error",
    name: "NAVStale",
    inputs: [
      { type: "uint256", name: "lastUpdate" },
      { type: "uint256", name: "threshold" },
    ],
  },
  {
    type: "error",
    name: "InsufficientLiquidityForProcessing",
    inputs: [
      { type: "uint256", name: "requiredAssets" },
      { type: "uint256", name: "availableAssets" },
    ],
  },
  {
    type: "error",
    name: "AllocationExceedsAvailable",
    inputs: [
      { type: "uint256", name: "requested" },
      { type: "uint256", name: "available" },
    ],
  },
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "currentNAV",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lastNAVUpdate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "NAV_STALENESS_THRESHOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isNAVFresh",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "currentCycleId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "cycles",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "uint256", name: "lockedNav" },
      { type: "uint256", name: "totalQueuedDepositAssets" },
      { type: "uint256", name: "totalQueuedRedeemShares" },
      { type: "uint256", name: "totalQueuedRedeemAssets" },
      { type: "uint256", name: "depositCursor" },
      { type: "uint256", name: "redeemCursor" },
      { type: "uint256", name: "processingStartedAt" },
      { type: "bool", name: "depositsComplete" },
      { type: "bool", name: "redeemsComplete" },
      { type: "bool", name: "finalized" },
    ],
  },
  {
    type: "function",
    name: "getCycleParticipants",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "cycleId" }],
    outputs: [
      { type: "address[]", name: "depositParticipants" },
      { type: "address[]", name: "redeemParticipants" },
    ],
  },
  {
    type: "function",
    name: "queuedDepositAssets",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "queuedRedeemShares",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableRedeemRequest",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableRedeemAssetsByController",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalClaimableRedeemAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxAllocatableAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ADMIN_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isOperator",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "bool" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "requestRedeem",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "closeBook",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "beginProcessing",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "processRedeems",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "processDeposits",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeProcessing",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "reopenIdleCycle",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "allocateToTradingWallet",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
] as const;

export const CLOSED_BOOK_BATCH_VAULT_ABI = FLAT_BOOK_VAULT_V2_ABI;
export const WEEKLY_EPOCH_VAULT_ABI = FLAT_BOOK_VAULT_V2_ABI;

function extractErrorText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const candidates = [
      obj.shortMessage,
      obj.details,
      obj.message,
      obj.reason,
      obj.cause && typeof obj.cause === "object"
        ? (obj.cause as Record<string, unknown>).message
        : undefined,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
  }

  return String(error);
}

export function parseContractError(error: unknown): string {
  const message = extractErrorText(error);
  if (message.includes("NAVStale")) {
    return "NAV is stale - settlement requires fresh NAV";
  }
  if (message.includes("InvalidState")) {
    const stateMatch = message.match(/\((\d+),\s*(\d+)\)/);
    if (stateMatch) {
      const expected = stateMatch[1] ?? "unknown";
      const actual = stateMatch[2] ?? "unknown";
      const label = (value: string): string => {
        switch (value) {
          case "0":
            return "Open";
          case "1":
            return "Closed";
          case "2":
            return "Processing";
          default:
            return value;
        }
      };
      return `Operation not available in current vault state (expected ${label(expected)}, actual ${label(actual)})`;
    }
    return "Operation not available in current vault state";
  }
  if (message.includes("InsufficientLiquidityForProcessing")) {
    return "Insufficient liquidity to start processing";
  }
  if (message.includes("AllocationExceedsAvailable")) {
    return "Allocation exceeds currently available vault assets";
  }
  if (message.includes("ZeroAmount")) {
    return "Operation amount must be greater than zero";
  }
  if (
    message.includes("AccessControlUnauthorizedAccount") ||
    message.includes("is missing role") ||
    message.includes("not authorized")
  ) {
    return "Signer is missing the required on-chain role";
  }
  if (message.includes("insufficient funds")) {
    return "Signer has insufficient native gas balance";
  }
  return message;
}

export class CustomVaultClient {
  private static readonly READ_CACHE_TTL_MS = 250;

  private readonly vaultAddress: Address;
  private readonly publicClient: any;
  private readonly readCache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly inFlightReads = new Map<string, Promise<unknown>>();

  constructor(params: { vaultAddress: Address; rpcUrl: string; chain?: Chain }) {
    this.vaultAddress = params.vaultAddress;
    this.publicClient = createPublicClient({
      transport: http(params.rpcUrl),
      chain: params.chain,
    }) as any;
  }

  private createReadKey(functionName: string, args: readonly unknown[]): string {
    return JSON.stringify([
      functionName,
      ...args.map((arg) =>
        typeof arg === "bigint"
          ? `${arg.toString()}n`
          : Array.isArray(arg)
            ? arg.map((value) => (typeof value === "bigint" ? `${value.toString()}n` : value))
            : arg,
      ),
    ]);
  }

  invalidateReadCache(): void {
    this.readCache.clear();
    this.inFlightReads.clear();
  }

  private async read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    const cacheKey = this.createReadKey(functionName, args);
    const now = Date.now();
    const cached = this.readCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const inFlight = this.inFlightReads.get(cacheKey);
    if (inFlight) {
      return (await inFlight) as T;
    }

    const request = this.publicClient
      .readContract({
        address: this.vaultAddress,
        abi: FLAT_BOOK_VAULT_V2_ABI,
        functionName,
        args,
      })
      .then((value: unknown) => {
        this.readCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + CustomVaultClient.READ_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        this.inFlightReads.delete(cacheKey);
      });

    this.inFlightReads.set(cacheKey, request);
    return (await request) as T;
  }

  private async write(
    walletClient: any,
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<TxResult> {
    try {
      const txHash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: FLAT_BOOK_VAULT_V2_ABI,
        functionName,
        args,
        chain: walletClient.chain,
        account: walletClient.account ?? null,
      });
      this.invalidateReadCache();
      return { success: true, txHash };
    } catch (error) {
      const parsed = parseContractError(error);
      logger.error("CustomVaultClient.write failed", {
        functionName,
        error: parsed,
        rawError: extractErrorText(error),
      });
      return { success: false, error: parsed };
    }
  }

  async waitForTransaction(txHash: Hex): Promise<{ success: boolean; error?: string }> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        return {
          success: false,
          error: `Transaction reverted on-chain (status: ${receipt.status})`,
        };
      }
      this.invalidateReadCache();
      return { success: true };
    } catch (error) {
      return { success: false, error: parseContractError(error) };
    }
  }

  async getAsset(): Promise<Address> {
    return this.read<Address>("asset");
  }

  async getVaultConfig(): Promise<VaultContractConfig> {
    const [navStalenessThreshold] = await Promise.all([
      this.read<bigint>("NAV_STALENESS_THRESHOLD"),
    ]);
    return {
      deployTime: 0n,
      navStalenessThreshold,
    };
  }

  async getNAVStatus(): Promise<NAVStatus> {
    const [currentNAV, lastNAVUpdate, isFresh] = await Promise.all([
      this.read<bigint>("currentNAV"),
      this.read<bigint>("lastNAVUpdate"),
      this.read<boolean>("isNAVFresh"),
    ]);
    return { currentNAV, lastNAVUpdate, isFresh };
  }

  async getEmergencyMode(): Promise<boolean> {
    return false;
  }

  async getCurrentBatch(): Promise<bigint> {
    return this.read<bigint>("currentCycleId");
  }

  async getCurrentBatchId(): Promise<bigint> {
    return this.getCurrentBatch();
  }

  private mapStateToBatchStatus(state: number, cycle: CycleData, isCurrent: boolean): BatchStatus {
    if (!isCurrent) {
      return cycle.finalized ? "settled" : "closed";
    }
    if (state === 0) return "open";
    if (state === 1) return "cutoff";
    if (state === 2) {
      if (cycle.redeemsComplete && cycle.depositsComplete) {
        return "settled";
      }
      return "flattening";
    }
    return "open";
  }

  private normalizeState(value: bigint | number): number {
    return typeof value === "bigint" ? Number(value) : value;
  }

  private async getCycle(cycleId: bigint): Promise<CycleData> {
    const raw = await this.read<
      [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean, boolean]
    >("cycles", [cycleId]);
    return {
      lockedNav: raw[0],
      totalQueuedDepositAssets: raw[1],
      totalQueuedRedeemShares: raw[2],
      totalQueuedRedeemAssets: raw[3],
      depositCursor: raw[4],
      redeemCursor: raw[5],
      processingStartedAt: raw[6],
      depositsComplete: raw[7],
      redeemsComplete: raw[8],
      finalized: raw[9],
    };
  }

  async getBatch(batchId: bigint): Promise<BatchData | null> {
    const [currentCycleId, rawState, navStatus] = await Promise.all([
      this.read<bigint>("currentCycleId"),
      this.read<bigint>("state"),
      this.getNAVStatus(),
    ]);
    const state = this.normalizeState(rawState);

    if (batchId > currentCycleId) {
      return null;
    }

    const cycle = await this.getCycle(batchId);
    const isCurrent = batchId === currentCycleId;
    const status = this.mapStateToBatchStatus(state, cycle, isCurrent);

    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const start = cycle.processingStartedAt > 0n ? cycle.processingStartedAt : nowTs;

    return {
      batchId,
      startTime: start,
      endTime: 0n,
      cutoffTime: 0n,
      snapshotNAV: cycle.lockedNav > 0n ? cycle.lockedNav : navStatus.currentNAV,
      lockedClearingPrice: cycle.lockedNav,
      snapshotTimestamp: cycle.processingStartedAt,
      totalSharesPending: cycle.totalQueuedRedeemShares,
      totalAssetsSnapshot: cycle.totalQueuedRedeemAssets,
      proRataRatio: 1000000000000000000n,
      totalQueuedDeposits: cycle.totalQueuedDepositAssets,
      status,
      isPriceLocked: cycle.lockedNav > 0n,
      exists: true,
    };
  }

  async getBatchStatus(batchId: bigint): Promise<BatchStatus> {
    const batch = await this.getBatch(batchId);
    return batch?.status ?? "open";
  }

  async getSettlementProgress(batchId: bigint): Promise<SettlementProgressData | null> {
    const [cycle, participants] = await Promise.all([
      this.getCycle(batchId),
      this.read<[Address[], Address[]]>("getCycleParticipants", [batchId]),
    ]);

    const total = BigInt(participants[1].length + participants[0].length);
    const processed = cycle.redeemCursor + cycle.depositCursor;
    return {
      processed,
      total,
      lastIndex: processed,
      reservedAssetsAllocated: cycle.totalQueuedRedeemAssets,
      isComplete: cycle.redeemsComplete && cycle.depositsComplete,
    };
  }

  private controllerToRequestId(controller: Address): bigint {
    return BigInt(controller.toLowerCase());
  }

  private requestIdToController(requestId: bigint): Address {
    const hex = requestId.toString(16).padStart(40, "0").slice(-40);
    return `0x${hex}` as Address;
  }

  async getControllerRequestIds(controller: Address): Promise<bigint[]> {
    const cycleId = await this.read<bigint>("currentCycleId");
    const [pendingShares, claimableShares] = await Promise.all([
      this.read<bigint>("queuedRedeemShares", [cycleId, controller]),
      this.read<bigint>("claimableRedeemRequest", [0n, controller]),
    ]);
    if (pendingShares > 0n || claimableShares > 0n) {
      return [
        this.controllerToRequestId(controller) +
          cycleId * 10000000000000000000000000000000000000000n,
      ];
    }
    return [];
  }

  async getDepositorBatchRequest(depositor: Address, batchId: bigint): Promise<bigint> {
    const cycleId = batchId > 0n ? batchId - 1n : await this.read<bigint>("currentCycleId");
    const queuedAssets = await this.read<bigint>("queuedDepositAssets", [cycleId, depositor]);
    if (queuedAssets > 0n) {
      return (
        this.controllerToRequestId(depositor) + cycleId * 10000000000000000000000000000000000000000n
      );
    }
    return 0n;
  }

  async getDepositRequest(requestId: bigint): Promise<DepositRequestData | null> {
    if (requestId === 0n) {
      return null;
    }
    const cycleFactor = 10000000000000000000000000000000000000000n;
    const cycleId = requestId / cycleFactor;
    const depositor = this.requestIdToController(requestId % cycleFactor);
    const queuedAssets = await this.read<bigint>("queuedDepositAssets", [cycleId, depositor]);
    if (queuedAssets === 0n) {
      return null;
    }
    return {
      requestId,
      depositor,
      assets: queuedAssets,
      targetBatch: cycleId + 1n,
      createdAt: 0n,
      status: "pending",
    };
  }

  async getRedemptionRequest(requestId: bigint): Promise<RedemptionRequestData | null> {
    const currentCycle = await this.read<bigint>("currentCycleId");
    const cycleFactor = 10000000000000000000000000000000000000000n;
    const cycleId = requestId / cycleFactor;
    const controllerRaw = requestId % cycleFactor;
    const controller = this.requestIdToController(controllerRaw);

    const [pendingShares, claimableShares, claimableAssets] = await Promise.all([
      this.read<bigint>("queuedRedeemShares", [currentCycle, controller]),
      this.read<bigint>("claimableRedeemRequest", [0n, controller]),
      this.read<bigint>("claimableRedeemAssetsByController", [controller]),
    ]);

    if (pendingShares === 0n && claimableShares === 0n && claimableAssets === 0n) {
      return null;
    }

    if (claimableShares > 0n || claimableAssets > 0n) {
      return {
        requestId,
        controller,
        owner: controller,
        shares: claimableShares,
        assetsClaimable: claimableAssets,
        batchId: cycleId,
        status: "claimable",
        createdAt: 0n,
        settledAt: 0n,
      };
    }

    return {
      requestId,
      controller,
      owner: controller,
      shares: pendingShares,
      assetsClaimable: 0n,
      batchId: currentCycle,
      status: "pending",
      createdAt: 0n,
      settledAt: 0n,
    };
  }

  async getTotalSupply(): Promise<bigint> {
    return this.read<bigint>("totalSupply");
  }

  async getTotalAssets(): Promise<bigint> {
    return this.read<bigint>("totalAssets");
  }

  async getTotalQueuedAssets(): Promise<bigint> {
    const cycleId = await this.read<bigint>("currentCycleId");
    const cycle = await this.getCycle(cycleId);
    return cycle.totalQueuedDepositAssets;
  }

  async getReservedRedemptionAssets(): Promise<bigint> {
    return this.read<bigint>("totalClaimableRedeemAssets");
  }

  async getMaxAllocatableAssets(): Promise<bigint> {
    return this.read<bigint>("maxAllocatableAssets");
  }

  async getAdminRole(): Promise<Hex> {
    return this.read<Hex>("ADMIN_ROLE");
  }

  async hasRole(role: Hex, account: Address): Promise<boolean> {
    return this.read<boolean>("hasRole", [role, account]);
  }

  async allocateToTradingWallet(walletClient: WalletClient, amount: bigint): Promise<TxResult> {
    return this.write(walletClient, "allocateToTradingWallet", [amount]);
  }

  async closeBook(walletClient: WalletClient): Promise<TxResult> {
    return this.write(walletClient, "closeBook", []);
  }

  async setOperator(
    walletClient: WalletClient,
    operator: Address,
    approved: boolean,
  ): Promise<TxResult> {
    return this.write(walletClient, "setOperator", [operator, approved]);
  }

  async isOperator(controller: Address, operator: Address): Promise<boolean> {
    return this.read<boolean>("isOperator", [controller, operator]);
  }

  async flattenBatch(walletClient: WalletClient, _snapshotHash: Hex): Promise<TxResult> {
    let state: number;
    try {
      state = this.normalizeState(await this.read<bigint>("state"));
    } catch (error) {
      return {
        success: false,
        error: `Failed to read vault state before beginProcessing: ${parseContractError(error)}`,
      };
    }

    if (state === 0) {
      const closeResult = await this.write(walletClient, "closeBook", []);
      if (!closeResult.success) {
        return closeResult;
      }

      const closeConfirm = await this.waitForTransaction(closeResult.txHash!);
      if (!closeConfirm.success) {
        return {
          success: false,
          txHash: closeResult.txHash,
          error: closeConfirm.error,
        };
      }
    }

    return this.write(walletClient, "beginProcessing", []);
  }

  async settleBatch(walletClient: WalletClient, _batchId: bigint): Promise<TxResult> {
    const step = 1000n;
    const redeemResult = await this.write(walletClient, "processRedeems", [step]);
    if (!redeemResult.success) return redeemResult;

    const depositResult = await this.write(walletClient, "processDeposits", [step]);
    if (!depositResult.success) return depositResult;

    return depositResult;
  }

  async reopenBatch(walletClient: WalletClient): Promise<TxResult> {
    return this.write(walletClient, "finalizeProcessing", []);
  }

  async reopenIdleCycle(walletClient: WalletClient): Promise<TxResult> {
    return this.write(walletClient, "reopenIdleCycle", []);
  }

  async processDepositQueue(
    walletClient: WalletClient,
    _batchId: bigint,
    _startIndex: bigint,
    endIndex: bigint,
  ): Promise<TxResult> {
    return this.write(walletClient, "processDeposits", [endIndex]);
  }
}

export function createCustomVaultClient(
  vaultAddress: Address,
  rpcUrl: string,
  chain?: Chain,
): CustomVaultClient {
  return new CustomVaultClient({ vaultAddress, rpcUrl, chain });
}
