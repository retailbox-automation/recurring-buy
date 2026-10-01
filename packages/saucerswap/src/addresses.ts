import type { Address } from "viem";

export type Network = "testnet" | "mainnet";

/** The SaucerSwap contracts this package uses, on one network. */
export type SaucerSwapAddresses = {
  /** WHBAR, HBAR as an HTS token: the first hop of any path that starts from HBAR. */
  whbar: Address;
  /** SaucerSwapV2SwapRouter: `RecurringBuy` swaps through its `exactInput`. The deploy scripts repeat this address. */
  router: Address;
  /** SaucerSwapV2QuoterV2: `quoteExactInput`, read through `eth_call`. */
  quoter: Address;
  /** WhbarHelper: `deposit()` wraps the HBAR sent with it into WHBAR for the sender. */
  whbarHelper: Address;
};

/** From docs.saucerswap.finance/developers/contracts; each has carried our testnet calls (docs/testnet-findings.md). */
export const TESTNET_ADDRESSES: SaucerSwapAddresses = {
  whbar: "0x0000000000000000000000000000000000003ad2", // WHBAR token 0.0.15058
  router: "0x0000000000000000000000000000000000159398", // SwapRouter 0.0.1414040
  quoter: "0x00000000000000000000000000000000001535b2", // QuoterV2 0.0.1390002
  whbarHelper: "0x000000000000000000000000000000000050a8a7", // WhbarHelper 0.0.5286055
};

/** From the same list; not exercised by us. */
export const MAINNET_ADDRESSES: SaucerSwapAddresses = {
  whbar: "0x0000000000000000000000000000000000163b5a", // WHBAR token 0.0.1456986
  router: "0x00000000000000000000000000000000003c437a", // SwapRouter 0.0.3949434
  quoter: "0x00000000000000000000000000000000003c4370", // QuoterV2 0.0.3949424
  whbarHelper: "0x000000000000000000000000000000000058a2ba", // WhbarHelper 0.0.5808826
};

export const ADDRESSES: Record<Network, SaucerSwapAddresses> = {
  testnet: TESTNET_ADDRESSES,
  mainnet: MAINNET_ADDRESSES,
};

export type NetworkEndpoints = { chainId: number; rpcUrl: string; mirrorUrl: string };

/** Matches packages/hardhat/hardhat.config.ts and packages/nextjs/scaffold.config.ts. */
export const ENDPOINTS: Record<Network, NetworkEndpoints> = {
  testnet: {
    chainId: 296,
    rpcUrl: "https://testnet.hashio.io/api",
    mirrorUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  },
  mainnet: {
    chainId: 295,
    rpcUrl: "https://mainnet.hashio.io/api",
    mirrorUrl: "https://mainnet-public.mirrornode.hedera.com/api/v1",
  },
};

/** The EVM address of a Hedera id "0.0.N" (account, contract or HTS token) that has no EVM alias: N as 20 bytes. */
export function hederaIdToLongZeroAddress(hederaId: string): Address {
  const parts = hederaId.split(".");
  if (parts.length !== 3 || parts.some(part => part === "" || !/^\d+$/.test(part))) {
    throw new Error(`not a Hedera id (expected "0.0.N"): ${hederaId}`);
  }
  return `0x${BigInt(parts[2]).toString(16).padStart(40, "0")}` as Address;
}
