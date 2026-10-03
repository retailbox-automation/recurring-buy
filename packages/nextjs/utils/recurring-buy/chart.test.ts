import { axisTicks, boughtTotals, cumulativeBought } from "./chart";
import type { TickRow } from "./plan";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const bought = (tick: number, amountOut: bigint): TickRow => ({
  tick,
  scheduleId: null,
  due: null,
  outcome: { kind: "bought", timestamp: `${1_790_000_000 + tick}.0`, amountIn: 2_500_000_000n, amountOut },
});

describe("cumulativeBought", () => {
  it("adds up what each tick bought, as plan #3 on testnet did", () => {
    const ticks = [
      bought(1, 1_006_880_169n),
      bought(2, 1_004_101_151n),
      bought(3, 1_001_320_053n),
      bought(4, 998_469_272n),
    ];
    assert.deepEqual(
      cumulativeBought(ticks).map(point => point.total),
      [1_006_880_169n, 2_010_981_320n, 3_012_301_373n, 4_010_770_645n],
    );
    assert.deepEqual(boughtTotals(ticks), { spent: 10_000_000_000n, received: 4_010_770_645n });
  });

  it("keeps the total flat on a skipped tick and has no point for a tick that has not run", () => {
    const ticks: TickRow[] = [
      bought(1, 100n),
      { tick: 2, scheduleId: null, due: null, outcome: { kind: "skipped", timestamp: "1790000002.0", reason: "x" } },
      bought(3, 50n),
      { tick: 4, scheduleId: "0.0.4", due: 1_790_000_004, outcome: { kind: "waiting" } },
    ];
    assert.deepEqual(
      cumulativeBought(ticks).map(({ tick, total }) => [tick, total]),
      [
        [1, 100n],
        [2, 100n],
        [3, 150n],
      ],
    );
  });
});

describe("axisTicks", () => {
  it("picks a round step whose last tick covers the maximum", () => {
    assert.deepEqual(axisTicks(4010.77), [0, 1500, 3000, 4500]);
    assert.deepEqual(axisTicks(8.18), [0, 3, 6, 9]);
  });
});
