import { formatUnits } from "viem";

const USDC_DECIMALS = 6;
const VAULT_SHARE_DECIMALS = 6;
const NAV_SCALE = 10n ** 18n;

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function derivePendingRedeemFallbackPricing(params: {
  grossTotalAssetsUnits: bigint;
  claimableRedeemAssetsRaw: bigint;
  queuedRedeemAssetsRaw: bigint;
  effectiveReservedRedemptionUnits: bigint;
  totalPendingRedeemSharesRaw: bigint;
}): {
  pendingRedeemUnits: bigint;
  pendingRedeemSharePrice: number;
  pendingRedeemNavUnits: bigint;
  usedQueuedRedeemAssets: boolean;
} {
  const {
    grossTotalAssetsUnits,
    claimableRedeemAssetsRaw,
    queuedRedeemAssetsRaw,
    effectiveReservedRedemptionUnits,
    totalPendingRedeemSharesRaw,
  } = params;

  if (totalPendingRedeemSharesRaw <= 0n) {
    return {
      pendingRedeemUnits: 0n,
      pendingRedeemSharePrice: 0,
      pendingRedeemNavUnits: NAV_SCALE,
      usedQueuedRedeemAssets: false,
    };
  }

  const pendingRedeemUnits =
    queuedRedeemAssetsRaw > 0n
      ? minBigInt(
          queuedRedeemAssetsRaw,
          grossTotalAssetsUnits > claimableRedeemAssetsRaw
            ? grossTotalAssetsUnits - claimableRedeemAssetsRaw
            : 0n,
        )
      : effectiveReservedRedemptionUnits;

  return {
    pendingRedeemUnits,
    pendingRedeemSharePrice:
      Number(formatUnits(pendingRedeemUnits, USDC_DECIMALS)) /
      Number(formatUnits(totalPendingRedeemSharesRaw, VAULT_SHARE_DECIMALS)),
    pendingRedeemNavUnits: (pendingRedeemUnits * NAV_SCALE) / totalPendingRedeemSharesRaw,
    usedQueuedRedeemAssets: queuedRedeemAssetsRaw > 0n,
  };
}
