import assert from "node:assert/strict";
import { test } from "node:test";

import { TESTNET_ADDRESSES } from "../src/addresses.js";
import { encodeSingleHopPath } from "../src/path.js";

const SAUCE = "0x0000000000000000000000000000000000120f46" as const; // testnet SAUCE token 0.0.1183558

test("encodeSingleHopPath packs tokenIn, a 3-byte fee and tokenOut, 43 bytes in all", () => {
  assert.equal(
    encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 3000, SAUCE),
    "0x0000000000000000000000000000000000003ad2" + "000bb8" + "0000000000000000000000000000000000120f46",
  );
});

test("encodeSingleHopPath rejects a fee that does not fit 3 bytes", () => {
  assert.throws(() => encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 2 ** 24, SAUCE));
});
