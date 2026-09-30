// network-fees.json is the testnet mirror node's /network/fees response of 2026-09-30.
import { MEASURED_GAS, tickCost } from "./costs";
import networkFees from "./fixtures/network-fees.json";
import { fetchGasPrice } from "./mirror";
import { fixtureMirror } from "./testing";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const TESTNET_PRICE = { contractCall: 109n, ethereumTransaction: 109n };

describe("fetchGasPrice", () => {
  it("reads the tinybar per gas the network bills from /network/fees", async () => {
    const { mirror, requested } = fixtureMirror({ "/network/fees": networkFees });
    assert.deepEqual(await fetchGasPrice(mirror), TESTNET_PRICE);
    assert.deepEqual(requested, ["/network/fees"]);
  });

  it("fails when a transaction type has no price", async () => {
    const fees = networkFees.fees.filter(fee => fee.transaction_type !== "ContractCall");
    const { mirror } = fixtureMirror({ "/network/fees": { ...networkFees, fees } });
    await assert.rejects(fetchGasPrice(mirror), /ContractCall/);
  });
});

describe("tickCost", () => {
  it("prices a tick at what the network charged for one", () => {
    // Run E, tick 1: 1,605,224 gas, a fee of 174,969,416 tinybar (docs/testnet-findings.md, E2).
    assert.equal(MEASURED_GAS.tick, 1_605_224n);
    assert.equal(tickCost(TESTNET_PRICE), 174_969_416n);
  });

  it("uses the price of a contract call, which is what a scheduled tick is", () => {
    assert.equal(tickCost({ contractCall: 100n, ethereumTransaction: 114n }), 160_522_400n);
  });
});
