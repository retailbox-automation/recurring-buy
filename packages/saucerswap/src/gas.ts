import type { PublicClient } from "viem";

/**
 * hashio's `eth_getBlockByNumber` under-reports `baseFeePerGas` (109 weibar),
 * while `eth_gasPrice`/`eth_feeHistory` correctly report ~1.14e12 weibar; a fee
 * estimator that reads the block header (viem's default EIP-1559
 * `estimateFeesPerGas`) computes a gas price the relay then rejects with "Gas
 * price ... is below configured minimum" (docs/PLATFORM-FINDINGS.md F3,
 * docs/research/spike-swap-2026-09-24.md). `getGasPrice()` calls `eth_gasPrice`
 * directly and sidesteps that.
 */
export const hashioGasPrice = (client: Pick<PublicClient, "getGasPrice">): Promise<bigint> => client.getGasPrice();

/**
 * Floor for a swap-shaped call's gasLimit, from 3 successful testnet
 * multicall[exactInput, refundETH] / HIP-1215 runs that spent 200,042-200,942 gas
 * (docs/research/spike-swap-2026-09-24.md S2/S5) — the QuoterV2 estimate (~92k,
 * `SwapQuote.quoterGasEstimate` in `./quote.js`) misses the HTS transfers
 * `exactInput` performs and is not a usable gasLimit on its own.
 */
export const SWAP_GAS_LIMIT_FLOOR = 220_000n;

/**
 * Recommended gasLimit for a swap-shaped call: a real `eth_estimateGas` on the
 * router call (not the quoter), padded 20%. A REVERTED call is only charged its
 * actual `gasUsed`, but a SUCCESSFUL one is charged the entire gasLimit
 * (docs/research/spike-swap-2026-09-24.md finding 3) — so padding only costs
 * money on a swap that was going to succeed anyway. Never below the observed
 * testnet floor above, in case the estimate undershoots.
 */
export function recommendedSwapGasLimit(estimatedGas: bigint): bigint {
  if (estimatedGas <= 0n) throw new Error(`estimatedGas must be > 0, got ${estimatedGas}`);
  const padded = (estimatedGas * 120n) / 100n;
  return padded > SWAP_GAS_LIMIT_FLOOR ? padded : SWAP_GAS_LIMIT_FLOOR;
}
