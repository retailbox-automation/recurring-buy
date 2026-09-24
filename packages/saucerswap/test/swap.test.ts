import assert from "node:assert/strict";
import { test } from "node:test";

import { TESTNET_ADDRESSES, hederaIdToLongZeroAddress } from "../src/addresses.js";
import { encodeSingleHopPath } from "../src/path.js";
import {
  type ExactInputParams,
  buildSwapFromHbarCalldata,
  buildSwapFromTokenCalldata,
  describeSwapCalldata,
  tinybarToWeibar,
} from "../src/swap.js";

const WHBAR = TESTNET_ADDRESSES.whbar;
const SAUCE = "0x0000000000000000000000000000000000120f46" as const; // testnet SAUCE token 0.0.1183558
const recipient = hederaIdToLongZeroAddress("0.0.10702176"); // "H" from docs/research/spike-swap-2026-09-24.md

const params: ExactInputParams = {
  path: encodeSingleHopPath(WHBAR, 3000, SAUCE),
  recipient,
  deadline: 1_790_275_104n,
  amountIn: 100_000_000n, // 1 HBAR, in tinybar
  amountOutMinimum: 45_873_079n, // spike S2's exact minOut
};

test("tinybarToWeibar matches the 1e10 factor the relay uses", () => {
  assert.equal(tinybarToWeibar(100_000_000n), 1_000_000_000_000_000_000n); // 1 HBAR -> 1e18 weibar
});

test("buildSwapFromHbarCalldata roundtrips through describeSwapCalldata", () => {
  const { data, valueWeibar } = buildSwapFromHbarCalldata(params);
  assert.equal(valueWeibar, tinybarToWeibar(params.amountIn));

  const decoded = describeSwapCalldata(data);
  assert.equal(decoded.functionName, "multicall");
  if (decoded.functionName !== "multicall") throw new Error("unreachable");
  assert.equal(decoded.calls.length, 2);

  const [swapCall, refundCall] = decoded.calls;
  assert.equal(refundCall.functionName, "refundETH");
  assert.equal(swapCall.functionName, "exactInput");
  if (swapCall.functionName !== "exactInput") throw new Error("unreachable");
  assert.deepEqual(swapCall.path.tokens, [WHBAR, SAUCE]);
  assert.deepEqual(swapCall.path.fees, [3000]);
  assert.equal(swapCall.recipient, recipient);
  assert.equal(swapCall.deadline, params.deadline);
  assert.equal(swapCall.amountIn, params.amountIn);
  assert.equal(swapCall.amountOutMinimum, params.amountOutMinimum);
  assert.equal(swapCall.valueWeibar, tinybarToWeibar(params.amountIn));
});

test("buildSwapFromTokenCalldata is a plain exactInput, no multicall", () => {
  const data = buildSwapFromTokenCalldata({ ...params, path: encodeSingleHopPath(SAUCE, 3000, WHBAR) });
  const decoded = describeSwapCalldata(data);
  assert.equal(decoded.functionName, "exactInput");
});

test("describeSwapCalldata rejects calldata that isn't from routerAbi", () => {
  assert.throws(() => describeSwapCalldata("0xdeadbeef"));
});
