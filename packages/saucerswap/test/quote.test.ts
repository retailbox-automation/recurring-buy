import assert from "node:assert/strict";
import { test } from "node:test";
import { type PublicClient, encodeFunctionResult } from "viem";

import { TESTNET_ADDRESSES } from "../src/addresses.js";
import { encodeSingleHopPath } from "../src/path.js";
import { minOut, quoteExactInput, quoterAbi } from "../src/quote.js";

const SAUCE = "0x0000000000000000000000000000000000120f46" as const; // testnet SAUCE token 0.0.1183558
const PATH = encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 3000, SAUCE);

/** A client whose `eth_call` answers with this QuoterV2 result. */
function quoterAnswering(
  result: readonly [bigint, readonly bigint[], readonly number[], bigint],
): Pick<PublicClient, "call"> {
  const data = encodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInput", result });
  return { call: async () => ({ data }) };
}

test("quoteExactInput reads amountOut and gasEstimate from their own places in the quoter's result", async () => {
  // The output of testnet swap S2 and the quoter's gas estimate in A6 (docs/testnet-findings.md).
  const client = quoterAnswering([46_336_444n, [2n ** 96n], [1], 92_234n]);
  const quote = await quoteExactInput(client, TESTNET_ADDRESSES.quoter, PATH, 100_000_000n);
  assert.deepEqual(quote, { amountOut: 46_336_444n, quoterGasEstimate: 92_234n });
});

test("quoteExactInput rejects a quote for more than the pool can take", async () => {
  // A pool that runs out of liquidity stops the swap at QuoterV2's price limit: TickMath's MIN_SQRT_RATIO + 1 when the
  // pool's first token goes in, MAX_SQRT_RATIO - 1 when its second does. The quote then covers only part of amountIn.
  for (const priceAtLimit of [4_295_128_740n, 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n]) {
    const client = quoterAnswering([46_336_444n, [priceAtLimit], [1], 92_234n]);
    await assert.rejects(quoteExactInput(client, TESTNET_ADDRESSES.quoter, PATH, 100_000_000n), /liquidity/);
  }
});

test("minOut takes slippageBps off the quote with integer math", () => {
  assert.equal(minOut(100_000_000n, 100), 99_000_000n); // 1% slippage
  assert.equal(minOut(46_336_444n, 100), 45_873_079n); // the floor of testnet swap S2
});

test("minOut at 0 bps returns the quote unchanged", () => {
  assert.equal(minOut(12_345n, 0), 12_345n);
});

test("minOut at 10000 bps (100%) returns 0", () => {
  assert.equal(minOut(12_345n, 10_000), 0n);
});

test("minOut rejects a non-integer or out-of-range slippageBps", () => {
  assert.throws(() => minOut(100n, 1.5), /integer/);
  assert.throws(() => minOut(100n, -1), /integer/);
  assert.throws(() => minOut(100n, 10_001), /integer/);
});

test("minOut rejects a non-positive quote", () => {
  assert.throws(() => minOut(0n, 100), /quotedAmountOut/);
});
