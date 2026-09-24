import assert from "node:assert/strict";
import { test } from "node:test";

import { TESTNET_ADDRESSES } from "../src/addresses.js";
import { decodePath, encodePath, encodeSingleHopPath } from "../src/path.js";

const WHBAR = TESTNET_ADDRESSES.whbar;
const SAUCE = "0x0000000000000000000000000000000000120f46" as const; // testnet SAUCE token 0.0.1183558
const USDC = "0x0000000000000000000000000000000000001549" as const; // an arbitrary third token, not a live address

test("encodePath/decodePath roundtrip a single hop", () => {
  const path = encodePath([WHBAR, SAUCE], [3000]);
  assert.equal(path, encodeSingleHopPath(WHBAR, 3000, SAUCE));
  const decoded = decodePath(path);
  assert.deepEqual(decoded.tokens, [WHBAR, SAUCE]);
  assert.deepEqual(decoded.fees, [3000]);
});

test("encodePath/decodePath roundtrip two hops", () => {
  const path = encodePath([WHBAR, SAUCE, USDC], [3000, 500]);
  const decoded = decodePath(path);
  assert.deepEqual(decoded.tokens, [WHBAR, SAUCE, USDC]);
  assert.deepEqual(decoded.fees, [3000, 500]);
});

test("encodePath rejects a fees/tokens length mismatch", () => {
  assert.throws(() => encodePath([WHBAR, SAUCE, USDC], [3000]), /fees/);
});

test("encodePath rejects fewer than 2 tokens", () => {
  assert.throws(() => encodePath([WHBAR], []), /at least 2 tokens/);
});

test("decodePath rejects a malformed path", () => {
  assert.throws(() => decodePath("0x1234"), /malformed/);
});
