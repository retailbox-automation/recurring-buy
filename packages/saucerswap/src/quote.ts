import { type Address, type Hex, type PublicClient, decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

/** SaucerSwapV2QuoterV2's `quoteExactInput` (docs.saucerswap.finance/developers/v2/quote). */
export const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export type SwapQuote = {
  /** Output amount, in the last token's smallest unit. */
  amountOut: bigint;
  /** The quoter's own estimate, which leaves out the HTS transfers of a swap: not a gas limit (A6). */
  quoterGasEstimate: bigint;
};

/**
 * The price limits QuoterV2 swaps toward when given none: TickMath's MIN_SQRT_RATIO + 1 when a pool's first token goes
 * in, MAX_SQRT_RATIO - 1 when its second does. SaucerSwap V2 keeps Uniswap V3's TickMath.
 */
const SQRT_PRICE_LIMITS: readonly bigint[] = [
  4_295_128_740n,
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n,
];

/**
 * What a swap of `amountIn` would give, from the quoter through `eth_call`. Rejects when the path has no pool, and
 * when a pool runs out of liquidity before it has taken all of `amountIn`: QuoterV2 then quotes only the part it could
 * swap and leaves the pool's price at the limit. An amount a pool can take only at a steep price is quoted as it is.
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
  const [amountOut, sqrtPriceX96AfterList, , quoterGasEstimate] = decodeFunctionResult({
    abi: quoterAbi,
    functionName: "quoteExactInput",
    data,
  });
  if (sqrtPriceX96AfterList.some(price => SQRT_PRICE_LIMITS.includes(price))) {
    throw new Error(`quoteExactInput: the pool ran out of liquidity before taking all of amountIn (${amountIn})`);
  }
  return { amountOut, quoterGasEstimate };
}

/**
 * The least output to accept, `slippageBps` basis points below the quote, in integers. The router reverts with "Too
 * little received" below it (docs/testnet-findings.md, S3).
 */
export function minOut(quotedAmountOut: bigint, slippageBps: number): bigint {
  if (quotedAmountOut <= 0n) throw new Error(`quotedAmountOut must be > 0, got ${quotedAmountOut}`);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`slippageBps must be an integer in [0, 10000], got ${slippageBps}`);
  }
  return (quotedAmountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
