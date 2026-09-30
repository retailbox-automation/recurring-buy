/** Three testnet swaps used 200,042 to 200,942 gas (docs/testnet-findings.md, S2 and S5). */
export const SWAP_GAS_LIMIT_FLOOR = 220_000n;

/**
 * A gas limit for a router call: its `eth_estimateGas` plus 20%, never below SWAP_GAS_LIMIT_FLOOR. Estimate the router
 * call, not the quoter, whose estimate leaves out the HTS transfers (A6). A scheduled call signed by its payer is
 * charged its whole gas limit when it succeeds (A3), so the margin costs HBAR there.
 */
export function recommendedSwapGasLimit(estimatedGas: bigint): bigint {
  if (estimatedGas <= 0n) throw new Error(`estimatedGas must be > 0, got ${estimatedGas}`);
  const padded = (estimatedGas * 120n) / 100n;
  return padded > SWAP_GAS_LIMIT_FLOOR ? padded : SWAP_GAS_LIMIT_FLOOR;
}
