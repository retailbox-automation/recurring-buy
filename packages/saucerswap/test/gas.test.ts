import assert from "node:assert/strict";
import { test } from "node:test";

import { SWAP_GAS_LIMIT_FLOOR, recommendedSwapGasLimit } from "../src/gas.js";

test("recommendedSwapGasLimit pads a real estimate by 20%", () => {
  assert.equal(recommendedSwapGasLimit(300_000n), 360_000n);
});

test("recommendedSwapGasLimit never drops below the observed testnet floor", () => {
  assert.equal(recommendedSwapGasLimit(10_000n), SWAP_GAS_LIMIT_FLOOR);
});

test("the quoter's low estimate, padded, still lands under the floor (testnet finding A6)", () => {
  // QuoterV2 estimated 92,234 gas for a swap that used 200,054.
  assert.equal(recommendedSwapGasLimit(92_234n), SWAP_GAS_LIMIT_FLOOR); // 92,234 * 1.2 = 110,680, under the floor
});

test("recommendedSwapGasLimit rejects a non-positive estimate", () => {
  assert.throws(() => recommendedSwapGasLimit(0n), /estimatedGas/);
});
