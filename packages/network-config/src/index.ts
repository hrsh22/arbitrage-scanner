export type { NetworkType, ChainConfig } from "./chains.js";
export {
  polygonMainnet,
  polygonAmoy,
  getChainConfig,
  getChainId,
  getDefaultRpcUrl,
  getFallbackRpcUrls,
  getBlockExplorerUrl,
} from "./chains.js";

export type { NetworkAddresses } from "./addresses.js";
export { getNetworkAddresses, getUsdcAddress, USDC_DECIMALS } from "./addresses.js";
