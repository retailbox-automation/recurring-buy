// Fixtures are testnet mirror node responses of 2026-09-30: /network/fees, and the account 0.0.10012993 with its WHBAR
// and SAUCE relationships (the account record keeps five fields).
import { MEASURED_GAS, type SignStep, gasLimitFor, stepsToSign, tickCost, walletState } from "./costs";
import ownerSauce from "./fixtures/account-0.0.10012993-sauce.json";
import ownerWhbar from "./fixtures/account-0.0.10012993-whbar.json";
import owner from "./fixtures/account-0.0.10012993.json";
import networkFees from "./fixtures/network-fees.json";
import { fetchGasPrice, fetchMirrorAccount } from "./mirror";
import { fixtureMirror } from "./testing";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const TESTNET_PRICE = { contractCall: 109n, ethereumTransaction: 109n };
const WHBAR = "0x0000000000000000000000000000000000003ad2"; // 0.0.15058
const SAUCE = "0x0000000000000000000000000000000000120f46"; // 0.0.1183558

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
  it("adds 20% to an estimate, as the wrap of run G was sent", () => {
    // eth_estimateGas said 85,252; the transaction carried a limit of 102,302 and used 77,966 (G1).
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
    // The demo owner of run E after run G: associated with both tokens, holding 0.15 WHBAR.
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

  it("asks an owner that associates tokens automatically to associate the token it buys", async () => {
    // 0.0.10012993 has unlimited automatic associations. It took WHBAR by automatic association, but its SAUCE
    // relationship is empty, and as the owner of a plan it received no SAUCE: the pool's transfer inside the tick ran
    // out of gas and the tick was skipped (hashscan.io/testnet/transaction/1790794091.124190452; D3).
    const OWNER = "0xa734fed00c784f223a46983742a18304c7027546";
    const { mirror } = fixtureMirror({
      [`/accounts/${OWNER}?transactions=false`]: owner,
      "/accounts/0.0.10012993/tokens?token.id=0.0.15058": ownerWhbar,
      "/accounts/0.0.10012993/tokens?token.id=0.0.1183558": ownerSauce,
    });
    assert.equal(owner.max_automatic_token_associations, -1);
    const account = await fetchMirrorAccount(mirror, OWNER, [WHBAR, SAUCE]);
    assert.ok(account);
    const steps = stepsToSign({
      spendIsWhbar: true,
      need: NEED,
      tokenReady: true,
      wallet: walletState(account, { tokenIn: WHBAR, tokenOut: SAUCE, allowance: NEED }),
    });
    assert.deepEqual(kinds(steps), ["associate-out", "wrap", "start"]);
    assert.equal(steps[1].amount, 15_000_000n);
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
