import { recurringBuyAbi } from "./abi";
import { type Abi, formatAbiItem } from "abitype";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Run from packages/nextjs. The artifact exists after `yarn hardhat:compile` or `yarn foundry:compile`.
const ARTIFACT = [
  "../hardhat/artifacts/contracts/RecurringBuy.sol/RecurringBuy.json",
  "../foundry/out/RecurringBuy.sol/RecurringBuy.json",
]
  .map(file => path.resolve(file))
  .find(existsSync);

/** The items of `abi` that `actual` lacks or declares differently, as human-readable signatures. */
function mismatches(abi: Abi, actual: Abi): string[] {
  const signatures = new Set(actual.map(item => formatAbiItem(item)));
  return abi.map(item => formatAbiItem(item)).filter(signature => !signatures.has(signature));
}

describe("recurringBuyAbi", () => {
  const skip = ARTIFACT ? false : "no RecurringBuy artifact: compile the contract first";

  it("matches the compiled contract", { skip }, () => {
    const { abi } = JSON.parse(readFileSync(ARTIFACT!, "utf8")) as { abi: Abi };
    assert.deepEqual(mismatches(recurringBuyAbi, abi), []);
  });

  it("would catch a changed event", { skip }, () => {
    const { abi } = JSON.parse(readFileSync(ARTIFACT!, "utf8")) as { abi: Abi };
    const changed = abi.map(item =>
      item.type === "event" && item.name === "TickExecuted"
        ? { ...item, inputs: item.inputs.map(input => ({ ...input, indexed: false })) }
        : item,
    );
    assert.deepEqual(mismatches(recurringBuyAbi, changed), [
      "event TickExecuted(uint256 indexed planId, uint64 tickNumber, uint256 amountIn, uint256 amountOut)",
    ]);
  });
});
