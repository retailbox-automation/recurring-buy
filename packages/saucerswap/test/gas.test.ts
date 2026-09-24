import assert from "node:assert/strict";
import { test } from "node:test";

import { SWAP_GAS_LIMIT_FLOOR, recommendedSwapGasLimit } from "../src/gas.js";

test("recommendedSwapGasLimit pads a real estimate by 20%", () => {
  assert.equal(recommendedSwapGasLimit(300_000n), 360_000n);
});

test("recommendedSwapGasLimit never drops below the observed testnet floor", () => {
  assert.equal(recommendedSwapGasLimit(10_000n), SWAP_GAS_LIMIT_FLOOR);
});

test("the quoter's low estimate, padded, still lands under the floor (finding 6)", () => {
  // QuoterV2 returned ~92,234-92,237 gas on testnet; the real swap needed ~200k.
  assert.equal(recommendedSwapGasLimit(92_237n), SWAP_GAS_LIMIT_FLOOR); // 92237 * 1.2 = 110,684 < floor
});

test("recommendedSwapGasLimit rejects a non-positive estimate", () => {
  assert.throws(() => recommendedSwapGasLimit(0n), /estimatedGas/);
});
