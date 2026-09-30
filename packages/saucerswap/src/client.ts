import { type PublicClient, createPublicClient, http } from "viem";

import { ENDPOINTS, type Network } from "./addresses.js";

/**
 * A viem chain for `network` through the hashio relay. `nativeCurrency.decimals` is 18 because the relay counts HBAR in
 * weibar; HBAR itself has 8 decimals (see `tinybarToWeibar`).
 */
export function saucerSwapChain(network: Network) {
  const { chainId, rpcUrl } = ENDPOINTS[network];
  return {
    id: chainId,
    name: network === "testnet" ? "Hedera Testnet" : "Hedera Mainnet",
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
}

/** A read-only viem client for `network`, pointed at hashio. */
export const createSaucerSwapClient = (network: Network): PublicClient =>
  createPublicClient({ chain: saucerSwapChain(network), transport: http() });
