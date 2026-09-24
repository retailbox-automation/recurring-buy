import { type PublicClient, createPublicClient, http } from "viem";

import { ENDPOINTS, type Network } from "./addresses.js";

/**
 * A minimal viem chain definition for `network`, sufficient for `eth_call` and
 * `eth_gasPrice` through the hashio JSON-RPC relay. `nativeCurrency.decimals` is 18
 * to match how the relay reports `msg.value`/balances, even though HBAR itself has 8
 * (see `tinybarToWeibar` in `./swap.js` and packages/nextjs/scaffold.config.ts).
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
