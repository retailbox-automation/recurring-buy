import type { TickRow } from "./plan";

/** The total bought up to and including one tick that ran. */
export type CumulativePoint = { tick: number; timestamp: string; total: bigint };

/**
 * One point per tick that ran, in tick order: a skipped tick keeps the total flat, and a tick that has not run (or
 * whose result the mirror node has not indexed yet) has no point.
 */
export function cumulativeBought(ticks: TickRow[]): CumulativePoint[] {
  let total = 0n;
  return ticks.flatMap(({ tick, outcome }) => {
    if (!("timestamp" in outcome) || outcome.kind === "indexing") return [];
    if (outcome.kind === "bought") total += outcome.amountOut;
    return [{ tick, timestamp: outcome.timestamp, total }];
  });
}

/** What the plan's buys spent and received, in the tokens' smallest units. */
export function boughtTotals(ticks: TickRow[]): { spent: bigint; received: bigint } {
  let spent = 0n;
  let received = 0n;
  for (const { outcome } of ticks) {
    if (outcome.kind !== "bought") continue;
    spent += outcome.amountIn;
    received += outcome.amountOut;
  }
  return { spent, received };
}

/** `intervals + 1` round values from 0 whose last one is at least `max`: 4,010.77 → 0, 1,500, 3,000, 4,500. */
export function axisTicks(max: number, intervals = 3): number[] {
  const raw = (max > 0 ? max : 1) / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 5, 10].map(m => m * magnitude).find(s => s * intervals >= max) ?? raw;
  return Array.from({ length: intervals + 1 }, (_, i) => i * step);
}
