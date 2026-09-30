// network-fees.json is the testnet mirror node's /network/fees response of 2026-09-30.
import { MEASURED_GAS, type SignStep, gasLimitFor, stepsToSign, tickCost } from "./costs";
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

describe("gasLimitFor", () => {
  it("adds 20% to an estimate, as the wrap of run F was sent", () => {
    // eth_estimateGas said 85,252; the transaction carried a limit of 102,302 and used 77,966 (F1).
    assert.equal(gasLimitFor(85_252n), 102_302n);
  });
});

describe("stepsToSign", () => {
  const NEED = 20_000_000n; // 0.2 WHBAR: four buys of 0.05
  const kinds = (steps: SignStep[]) => steps.map(step => step.kind);

  it("a new account spending WHBAR it does not have signs five transactions", () => {
    const steps = stepsToSign({
      spendIsWhbar: true,
      need: NEED,
      tokenReady: true,
      wallet: { holdsOut: false, holdsIn: false, balanceIn: 0n, allowance: 0n },
    });
    assert.deepEqual(kinds(steps), ["associate-out", "associate-in", "wrap", "approve", "start"]);
    assert.equal(steps.find(step => step.kind === "wrap")?.amount, NEED);
    assert.ok(steps.every(step => !step.ifNeeded));
  });

  it("wraps only what the balance is short of", () => {
    // The demo owner of run E after run F: associated with both tokens, holding 0.15 WHBAR.
    const steps = stepsToSign({
      spendIsWhbar: true,
      need: NEED,
      tokenReady: true,
      wallet: { holdsOut: true, holdsIn: true, balanceIn: 15_000_000n, allowance: 0n },
    });
    assert.deepEqual(kinds(steps), ["wrap", "approve", "start"]);
    assert.equal(steps[0].amount, 5_000_000n);
    assert.equal(steps[0].gas, MEASURED_GAS.wrap);
  });

  it("leaves out what is already done", () => {
    const steps = stepsToSign({
      spendIsWhbar: true,
      need: NEED,
      tokenReady: true,
      wallet: { holdsOut: true, holdsIn: true, balanceIn: NEED, allowance: NEED },
    });
    assert.deepEqual(kinds(steps), ["start"]);
  });

  it("offers no wrap for a spend token other than WHBAR", () => {
    const steps = stepsToSign({
      spendIsWhbar: false,
      need: NEED,
      tokenReady: true,
      wallet: { holdsOut: false, holdsIn: false, balanceIn: 0n, allowance: 0n },
    });
    assert.deepEqual(kinds(steps), ["associate-out", "approve", "start"]);
  });

  it("before the wallet is read, lists every step that may be needed as such", () => {
    const steps = stepsToSign({ spendIsWhbar: true, need: NEED, tokenReady: true, wallet: {} });
    assert.deepEqual(kinds(steps), ["associate-out", "associate-in", "wrap", "approve", "start"]);
    assert.deepEqual(
      steps.map(step => step.ifNeeded),
      [true, true, true, true, false],
    );
  });

  it("adds the contract's one-time preparation of a new spend token to start", () => {
    // Run E, plan 1: the first plan on WHBAR; its start used 3,114,516 gas (docs/testnet-findings.md, E4).
    const [start] = stepsToSign({
      spendIsWhbar: false,
      need: NEED,
      tokenReady: false,
      wallet: { holdsOut: true, holdsIn: true, balanceIn: NEED, allowance: NEED },
    });
    assert.equal(start.gas, 3_114_516n);
  });
});
