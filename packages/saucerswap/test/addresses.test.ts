import assert from "node:assert/strict";
import { test } from "node:test";

import { MAINNET_ADDRESSES, TESTNET_ADDRESSES, hederaIdToLongZeroAddress } from "../src/addresses.js";

test("hederaIdToLongZeroAddress matches the live-verified testnet addresses", () => {
  assert.equal(hederaIdToLongZeroAddress("0.0.15058"), TESTNET_ADDRESSES.whbar);
  assert.equal(hederaIdToLongZeroAddress("0.0.1414040"), TESTNET_ADDRESSES.router);
  assert.equal(hederaIdToLongZeroAddress("0.0.1390002"), TESTNET_ADDRESSES.quoter);
});

test("hederaIdToLongZeroAddress matches the mainnet addresses from the vendor docs", () => {
  assert.equal(hederaIdToLongZeroAddress("0.0.1456986"), MAINNET_ADDRESSES.whbar);
  assert.equal(hederaIdToLongZeroAddress("0.0.3949434"), MAINNET_ADDRESSES.router);
  assert.equal(hederaIdToLongZeroAddress("0.0.3949424"), MAINNET_ADDRESSES.quoter);
});

test("hederaIdToLongZeroAddress rejects a malformed id", () => {
  assert.throws(() => hederaIdToLongZeroAddress("0.0"), /not a Hedera id/);
  assert.throws(() => hederaIdToLongZeroAddress("not-an-id"), /not a Hedera id/);
});

test("hederaIdToLongZeroAddress rejects a shard or realm other than 0", () => {
  assert.throws(() => hederaIdToLongZeroAddress("1.2.5"), /0\.0\.N/);
  assert.throws(() => hederaIdToLongZeroAddress("0.1.5"), /0\.0\.N/);
  assert.throws(() => hederaIdToLongZeroAddress("1.0.5"), /0\.0\.N/);
});

test("hederaIdToLongZeroAddress takes an entity number of up to 8 bytes, the address's own field for it", () => {
  assert.equal(hederaIdToLongZeroAddress("0.0.18446744073709551615"), "0x000000000000000000000000ffffffffffffffff");
  assert.throws(() => hederaIdToLongZeroAddress("0.0.18446744073709551616"), /8 bytes/);
});
