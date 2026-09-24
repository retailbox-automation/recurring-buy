import { type Address, type Hex, type PublicClient, decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

/** SaucerSwapV2QuoterV2.quoteExactInput — gas-free swap quotes (docs.saucerswap.finance/developers/v2/quote). */
export const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export type SwapQuote = {
  /** Output amount, in the last token's smallest unit. */
  amountOut: bigint;
  /**
   * The quoter's own gas estimate. Too low for a real swap's gasLimit — it does
   * not include the HTS transfers `exactInput` performs (docs/PLATFORM-FINDINGS.md
   * F8, finding 6 of docs/research/spike-swap-2026-09-24.md). Use
   * `recommendedSwapGasLimit` from `./gas.js` with a real `eth_estimateGas` on the
   * router call instead.
   */
  quoterGasEstimate: bigint;
};

/**
 * Simulates a swap through `quoteExactInput` via `eth_call` — no gas cost, no
 * wallet needed. Rejects (the client throws) when the path has no pool, or no
 * liquidity for `amountIn`.
 */
export async function quoteExactInput(
  client: Pick<PublicClient, "call">,
  quoter: Address,
  path: Hex,
  amountIn: bigint,
): Promise<SwapQuote> {
  if (amountIn <= 0n) throw new Error(`amountIn must be > 0, got ${amountIn}`);
  const { data } = await client.call({
    to: quoter,
    data: encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInput", args: [path, amountIn] }),
  });
  if (!data) throw new Error("quoteExactInput: the quoter returned no data");
  const [amountOut, , , quoterGasEstimate] = decodeFunctionResult({
    abi: quoterAbi,
    functionName: "quoteExactInput",
    data,
  });
  return { amountOut, quoterGasEstimate };
}

/**
 * Minimum acceptable output for a swap, `slippageBps` basis points below the
 * quote — integer math only, matching what the router enforces on-chain
 * (`amountOutMinimum`; reverts with "Too little received" otherwise,
 * docs/research/spike-swap-2026-09-24.md S3).
 */
export function minOut(quotedAmountOut: bigint, slippageBps: number): bigint {
  if (quotedAmountOut <= 0n) throw new Error(`quotedAmountOut must be > 0, got ${quotedAmountOut}`);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`slippageBps must be an integer in [0, 10000], got ${slippageBps}`);
  }
  return (quotedAmountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
