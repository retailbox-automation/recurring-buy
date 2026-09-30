import type { Address } from "viem";

export type Network = "testnet" | "mainnet";

/** SaucerSwap V2 protocol contracts needed to quote and build a swap — one set per network. */
export type SaucerSwapAddresses = {
  /** WHBAR HTS token — the first hop of any path that starts from HBAR. */
  whbar: Address;
  /** SaucerSwapV2SwapRouter — `exactInput`/`multicall`/`refundETH`. */
  router: Address;
  /** SaucerSwapV2QuoterV2 — `quoteExactInput`, no gas cost. */
  quoter: Address;
};

/**
 * Verified live against docs.saucerswap.finance/developers/contracts.md and a real
 * scheduled testnet swap (docs/testnet-findings.md, S1-S5) on 2026-09-24.
 */
export const TESTNET_ADDRESSES: SaucerSwapAddresses = {
  whbar: "0x0000000000000000000000000000000000003ad2", // WHBAR token 0.0.15058
  router: "0x0000000000000000000000000000000000159398", // SwapRouter 0.0.1414040
  quoter: "0x00000000000000000000000000000000001535b2", // QuoterV2 0.0.1390002
};

/**
 * From docs.saucerswap.finance/developers/contracts.md, checked 2026-09-24 — NOT
 * exercised on-chain by us. Only the testnet addresses above have a live transaction.
 */
export const MAINNET_ADDRESSES: SaucerSwapAddresses = {
  whbar: "0x0000000000000000000000000000000000163b5a", // WHBAR token 0.0.1456986
  router: "0x00000000000000000000000000000000003c437a", // SwapRouter 0.0.3949434
  quoter: "0x00000000000000000000000000000000003c4370", // QuoterV2 0.0.3949424
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

/**
 * Converts a Hedera id ("0.0.N": account, contract, or HTS token) to its EVM
 * long-zero address — the standard mapping for anything without a separate EVM alias.
 */
export function hederaIdToLongZeroAddress(hederaId: string): Address {
  const parts = hederaId.split(".");
  if (parts.length !== 3 || parts.some(part => part === "" || !/^\d+$/.test(part))) {
    throw new Error(`not a Hedera id (expected "0.0.N"): ${hederaId}`);
  }
  return `0x${BigInt(parts[2]).toString(16).padStart(40, "0")}` as Address;
}
