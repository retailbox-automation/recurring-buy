import assert from "node:assert/strict";
import { test } from "node:test";

import { minOut } from "../src/quote.js";

test("minOut takes slippageBps off the quote with integer math", () => {
  assert.equal(minOut(100_000_000n, 100), 99_000_000n); // 1% slippage
  assert.equal(minOut(46_336_444n, 100), 45_873_079n); // matches spike S2's minOut exactly
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
