import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";

import { MAINNET_ADDRESSES, TESTNET_ADDRESSES, hederaIdToLongZeroAddress } from "../src/addresses.js";
import { buildWrapHbar, whbarHelperAbi } from "../src/wrap.js";

test("the WhbarHelper addresses are the ones in SaucerSwap's contract list", () => {
  assert.equal(hederaIdToLongZeroAddress("0.0.5286055"), TESTNET_ADDRESSES.whbarHelper);
  assert.equal(hederaIdToLongZeroAddress("0.0.5808826"), MAINNET_ADDRESSES.whbarHelper);
});

test("buildWrapHbar calls WhbarHelper.deposit() and carries the amount as value, in weibar", () => {
  const request = buildWrapHbar(TESTNET_ADDRESSES, 25_000_000n); // 0.25 HBAR
  assert.equal(request.to, TESTNET_ADDRESSES.whbarHelper);
  assert.equal(request.data, "0xd0e30db0");
  assert.equal(decodeFunctionData({ abi: whbarHelperAbi, data: request.data }).functionName, "deposit");
  assert.equal(request.value, 250_000_000_000_000_000n);
});

test("buildWrapHbar refuses nothing to wrap: WHBAR reverts on a deposit of zero", () => {
  assert.throws(() => buildWrapHbar(TESTNET_ADDRESSES, 0n), /above zero/);
});
