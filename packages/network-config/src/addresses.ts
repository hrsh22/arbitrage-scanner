import type { NetworkType } from "./chains.js";

export interface NetworkAddresses {
  usdc: `0x${string}`;
  // Safe singleton and factory addresses (same across networks for Safe v1.4.1)
  safeSingleton: `0x${string}`;
  safeProxyFactory: `0x${string}`;
  safeFallbackHandler: `0x${string}`;
}

const MAINNET_ADDRESSES: NetworkAddresses = {
  // Native USDC on Polygon Mainnet
  usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  // Safe v1.4.1 addresses (same on all EVM chains)
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  safeFallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

const TESTNET_ADDRESSES: NetworkAddresses = {
  // Circle's testnet USDC on Polygon Amoy
  // If you need a different test token, update this address
  usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  // Safe v1.4.1 addresses (same on all EVM chains including testnets)
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  safeFallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

export function getNetworkAddresses(network: NetworkType): NetworkAddresses {
  return network === "mainnet" ? MAINNET_ADDRESSES : TESTNET_ADDRESSES;
}

export function getUsdcAddress(network: NetworkType): `0x${string}` {
  return getNetworkAddresses(network).usdc;
}

export const USDC_DECIMALS = 6;
