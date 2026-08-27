"use client";

import Image from "next/image";
import { cn } from "@workspace/ui/lib/utils";

export type AssetType = "usdc" | "btc" | "gnosis-safe" | "polymarket";

export interface AssetLogoProps {
  asset: AssetType;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  showLabel?: boolean;
  label?: string;
}

const ASSET_CONFIG: Record<AssetType, { src: string; alt: string; defaultLabel: string }> = {
  usdc: {
    src: "/logo/usdc-logo.svg",
    alt: "USDC",
    defaultLabel: "USDC",
  },
  btc: {
    src: "/logo/btc-logo.svg",
    alt: "Bitcoin",
    defaultLabel: "BTC",
  },
  "gnosis-safe": {
    src: "/logo/gnosis-safe.svg",
    alt: "Gnosis Safe",
    defaultLabel: "Safe",
  },
  polymarket: {
    src: "/logo/polymarket.png",
    alt: "Polymarket",
    defaultLabel: "Polymarket",
  },
};

const SIZE_MAP = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 32,
};

export function AssetLogo({
  asset,
  size = "sm",
  className,
  showLabel = false,
  label,
}: AssetLogoProps) {
  const config = ASSET_CONFIG[asset];
  const dimension = SIZE_MAP[size];

  if (showLabel) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <Image
          src={config.src}
          alt={config.alt}
          width={dimension}
          height={dimension}
          className="shrink-0"
        />
        <span className="text-inherit">{label ?? config.defaultLabel}</span>
      </span>
    );
  }

  return (
    <Image
      src={config.src}
      alt={config.alt}
      width={dimension}
      height={dimension}
      className={cn("shrink-0", className)}
    />
  );
}

export function AssetBadge({
  asset,
  size = "sm",
  className,
  variant = "default",
  label,
}: {
  asset: AssetType;
  size?: "xs" | "sm" | "md";
  className?: string;
  variant?: "default" | "outline" | "ghost";
  label?: string;
}) {
  const config = ASSET_CONFIG[asset];
  const dimension = SIZE_MAP[size];

  const variantStyles = {
    default: "bg-[#F1EEE8] border-[#CCCAC4] text-[#1A202C]",
    outline: "bg-transparent border-[#CCCAC4] text-[#615E4E]",
    ghost: "bg-transparent border-transparent text-[#615E4E]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
    >
      <Image
        src={config.src}
        alt={config.alt}
        width={dimension}
        height={dimension}
        className="shrink-0"
      />
      <span>{label ?? config.defaultLabel}</span>
    </span>
  );
}

export function AssetLogoStack({
  assets,
  size = "sm",
  className,
}: {
  assets: AssetType[];
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const dimension = SIZE_MAP[size];
  const overlap = dimension * 0.35;

  return (
    <span className={cn("inline-flex items-center", className)}>
      {assets.map((asset, index) => {
        const config = ASSET_CONFIG[asset];
        return (
          <span
            key={asset}
            className="relative rounded-full bg-[#F1EEE8] ring-2 ring-[#F1EEE8]"
            style={{
              marginLeft: index > 0 ? -overlap : 0,
              zIndex: assets.length - index,
            }}
          >
            <Image
              src={config.src}
              alt={config.alt}
              width={dimension}
              height={dimension}
              className="shrink-0"
            />
          </span>
        );
      })}
    </span>
  );
}
