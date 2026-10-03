import { STOP_REASONS, type StopReason, recurringBuyAbi } from "./abi";
import {
  type Mirror,
  type MirrorLog,
  type MirrorSchedule,
  type ScheduleState,
  fetchExecution,
  hederaIdOf,
  scheduleState,
} from "./mirror";
import { type Address, type Hex, decodeErrorResult, decodeEventLog, getAddress, isAddressEqual, parseAbi } from "viem";

// A plan's history as the app shows it, rebuilt from RecurringBuy's events and the mirror node's schedule records.
// Browser-safe and framework-free, so the unit tests run it on recorded mirror node responses.

export type PlanParams = {
  tokenIn: Address;
  /** Pool fee in hundredths of a bip: 3000 = 0.3%. */
  fee: number;
  tokenOut: Address;
  amountPerTick: bigint;
  minAmountOut: bigint;
  period: bigint;
  /** 0 = until stopped. */
  maxTicks: bigint;
  tickGasLimit: bigint;
};

type Logged = { planId: bigint; timestamp: string };

export type PlanEvent =
  | (Logged & { type: "PlanCreated"; owner: Address; params: PlanParams; deposit: bigint })
  | (Logged & { type: "TickScheduled"; tick: number; scheduleId: string; expiry: number })
  | (Logged & { type: "TickExecuted"; tick: number; amountIn: bigint; amountOut: bigint })
  | (Logged & { type: "TickSkipped"; tick: number; reason: Hex })
  | (Logged & { type: "PlanStopped"; ticksDone: number; reason: StopReason; hssResponseCode: number })
  | (Logged & { type: "GasDepositAdded"; amount: bigint })
  | (Logged & { type: "GasRefunded"; to: Address; amount: bigint });

/** The RecurringBuy event in a mirror node log entry, or null when the entry is not one. */
export function decodePlanLog(log: MirrorLog): PlanEvent | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: recurringBuyAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
  } catch {
    return null;
  }
  const at = { planId: decoded.args.planId, timestamp: log.timestamp };
  switch (decoded.eventName) {
    case "PlanCreated": {
      const { owner, params, deposit } = decoded.args;
      return { ...at, type: "PlanCreated", owner, params: { ...params }, deposit };
    }
    case "TickScheduled":
      return {
        ...at,
        type: "TickScheduled",
        tick: Number(decoded.args.tickNumber),
        scheduleId: hederaIdOf(decoded.args.schedule),
        expiry: Number(decoded.args.expirySecond),
      };
    case "TickExecuted": {
      const { tickNumber, amountIn, amountOut } = decoded.args;
      return { ...at, type: "TickExecuted", tick: Number(tickNumber), amountIn, amountOut };
    }
    case "TickSkipped":
      return { ...at, type: "TickSkipped", tick: Number(decoded.args.tickNumber), reason: decoded.args.reason };
    case "PlanStopped": {
      const { ticksDone, reason, hssResponseCode } = decoded.args;
      return {
        ...at,
        type: "PlanStopped",
        ticksDone: Number(ticksDone),
        reason: STOP_REASONS[reason] ?? "Completed",
        hssResponseCode: Number(hssResponseCode),
      };
    }
    case "GasDepositAdded":
      return { ...at, type: "GasDepositAdded", amount: decoded.args.amount };
    case "GasRefunded":
      return { ...at, type: "GasRefunded", to: decoded.args.to, amount: decoded.args.amount };
  }
}

const revertAbi = [...recurringBuyAbi, ...parseAbi(["error Error(string message)", "error Panic(uint256 code)"])];

/** A tick's revert reason, as bytes from TickSkipped or an `error_message`, in words. */
function describeRevert(data: Hex | null): string {
  if (!data || data === "0x") return "no reason given; for example, out of gas";
  try {
    const { errorName, args } = decodeErrorResult({ abi: revertAbi, data });
    if (errorName === "Error") return String(args[0]);
    return `${errorName}(${args.map(String).join(", ")})`;
  } catch {
    return `error ${data.slice(0, 10)}`;
  }
}

/** SaucerSwap's revert when a buy would get less than the plan's `minAmountOut`. */
export const BELOW_FLOOR_REASON = "Too little received";

type TickOutcome =
  | { kind: "bought"; timestamp: string; amountIn: bigint; amountOut: bigint }
  | { kind: "skipped"; timestamp: string; reason: string }
  /** The allowance or balance could not cover one buy: the plan stopped at this tick. */
  | { kind: "pull-failed"; timestamp: string }
  /** The whole tick reverted: nothing was bought and nothing was scheduled after it. */
  | { kind: "reverted"; timestamp: string; reason: string }
  | { kind: "waiting" }
  | { kind: "due" }
  /** Hedera never ran the schedule (the mirror node keeps showing it as not executed). */
  | { kind: "missed" }
  /** `stop` deleted the schedule before it ran. */
  | { kind: "cancelled" }
  /** Executed, and the mirror node has not indexed what it did yet. */
  | { kind: "indexing"; timestamp: string };

export type TickRow = {
  tick: number;
  scheduleId: string | null;
  /** The second the tick was scheduled for. */
  due: number | null;
  outcome: TickOutcome;
};

export type ChainStatus =
  | { kind: "running"; tick: number; due: number }
  | { kind: "due"; tick: number; due: number }
  | {
      kind: "stopped";
      reason: StopReason;
      ticksDone: number;
      hssResponseCode: number;
      timestamp: string;
      /** The tick that had already broken the chain when the owner stopped the plan: nothing was left to delete. */
      brokenAt: number | null;
    }
  /** No stop event, and no tick will run again: the contract may still call the plan active. */
  | { kind: "broken"; tick: number; detail: string }
  | { kind: "indexing" };

/** What the mirror node says about the schedule of a tick that has no outcome event. */
type ScheduleLookup = { record: MirrorSchedule | null; state: ScheduleState | null; revert: string | null };

/**
 * One row per tick, from the plan's events. A tick without an outcome event is settled from `lookups` (by schedule id):
 * a tick that reverted as a whole leaves no event at all, only its schedule's execution record.
 */
export function buildTicks(events: PlanEvent[], lookups: Record<string, ScheduleLookup>): TickRow[] {
  const rows = new Map<number, TickRow>();
  const row = (tick: number) => {
    let found = rows.get(tick);
    if (!found) {
      found = { tick, scheduleId: null, due: null, outcome: { kind: "indexing", timestamp: "" } };
      rows.set(tick, found);
    }
    return found;
  };
  const settled = new Set<number>();
  for (const event of events) {
    if (event.type === "TickScheduled")
      Object.assign(row(event.tick), { scheduleId: event.scheduleId, due: event.expiry });
    if (event.type === "TickExecuted") {
      const { timestamp, amountIn, amountOut } = event;
      row(event.tick).outcome = { kind: "bought", timestamp, amountIn, amountOut };
      settled.add(event.tick);
    }
    if (event.type === "TickSkipped") {
      row(event.tick).outcome = { kind: "skipped", timestamp: event.timestamp, reason: describeRevert(event.reason) };
      settled.add(event.tick);
    }
    if (event.type === "PlanStopped" && event.reason === "PullFailed") {
      row(event.ticksDone).outcome = { kind: "pull-failed", timestamp: event.timestamp };
      settled.add(event.ticksDone);
    }
  }
  for (const [tick, entry] of rows) {
    if (settled.has(tick) || !entry.scheduleId) continue;
    entry.outcome = fromSchedule(lookups[entry.scheduleId]);
  }
  return [...rows.values()].sort((a, b) => a.tick - b.tick);
}

function fromSchedule(lookup: ScheduleLookup | undefined): TickOutcome {
  const record = lookup?.record;
  if (!record || !lookup.state) return { kind: "indexing", timestamp: "" };
  switch (lookup.state) {
    case "waiting":
    case "due":
    case "missed":
      return { kind: lookup.state };
    case "deleted":
      return { kind: "cancelled" };
    case "executed":
      return lookup.revert === null
        ? { kind: "indexing", timestamp: record.executed_timestamp ?? "" }
        : { kind: "reverted", timestamp: record.executed_timestamp ?? "", reason: lookup.revert };
  }
}

/**
 * Whether the plan's chain of ticks is still going, from the last tick's schedule, not from the contract's `active`
 * flag: a tick that reverts as a whole takes its own bookkeeping with it, so `active` stays true while nothing is
 * scheduled any more (docs/testnet-findings.md, B9).
 */
export function chainStatus(events: PlanEvent[], ticks: TickRow[]): ChainStatus {
  const stop = events.findLast(event => event.type === "PlanStopped");
  const last = ticks[ticks.length - 1];
  if (stop?.type === "PlanStopped") {
    const { reason, ticksDone, hssResponseCode, timestamp } = stop;
    // A pending tick that `stop` could not delete runs later and reverts with PlanNotActive; only a tick that failed
    // before the stop had broken the chain.
    const stoppedAt = Number(timestamp);
    const broke =
      last &&
      last.tick > ticksDone &&
      ((last.outcome.kind === "reverted" && Number(last.outcome.timestamp) < stoppedAt) ||
        (last.outcome.kind === "missed" && (last.due ?? 0) < stoppedAt));
    return { kind: "stopped", reason, ticksDone, hssResponseCode, timestamp, brokenAt: broke ? last.tick : null };
  }
  if (!last) return { kind: "indexing" };
  const { outcome } = last;
  if (outcome.kind === "waiting") return { kind: "running", tick: last.tick, due: last.due ?? 0 };
  if (outcome.kind === "due") return { kind: "due", tick: last.tick, due: last.due ?? 0 };
  if (outcome.kind === "missed") return { kind: "broken", tick: last.tick, detail: "Hedera did not run its schedule" };
  if (outcome.kind === "reverted")
    return { kind: "broken", tick: last.tick, detail: `it reverted (${outcome.reason})` };
  if (outcome.kind === "cancelled") return { kind: "broken", tick: last.tick, detail: "its schedule was deleted" };
  // A finished tick always schedules the next one or stops the plan, in the same transaction.
  return { kind: "indexing" };
}

/** Ticks the contract counts in `ticksDone`: bought, skipped, or ended by a failed pull. */
export const ticksRun = (ticks: TickRow[]) =>
  ticks.filter(row => ["bought", "skipped", "pull-failed"].includes(row.outcome.kind)).length;

/** When the tick ran, or else when it is due, in unix seconds; null for a tick known only from an outcome event. */
export const tickTime = ({ outcome, due }: TickRow): number | null =>
  "timestamp" in outcome && outcome.timestamp ? Number(outcome.timestamp.split(".")[0]) : due;

export type PlanView = {
  planId: bigint;
  owner: Address;
  params: PlanParams;
  deposit: bigint;
  createdAt: string;
  ticks: TickRow[];
  status: ChainStatus;
  /** Sum of GasDepositAdded. */
  toppedUp: bigint;
  /** Sum of GasRefunded. */
  refunded: bigint;
};

type ContractEvents = {
  /** The contract's Hedera id, "0.0.N". */
  contractId: string;
  /** Oldest first. */
  events: PlanEvent[];
  /** More than `maxPages` pages of logs: the oldest are missing. */
  truncated: boolean;
};

/**
 * RecurringBuy events of `contract` (its EVM address or id), read newest page first. The mirror node filters logs by
 * topic only within a timestamp range, so the plan filter runs here. With `planId`, paging stops at the page that holds
 * that plan's PlanCreated: every later event of the plan is newer, so it is already read. Null when the mirror node has
 * no such contract.
 */
export async function loadContractEvents(
  mirror: Mirror,
  contract: string,
  { planId, maxPages = planId === undefined ? 20 : 50 }: { planId?: bigint; maxPages?: number } = {},
): Promise<ContractEvents | null> {
  const record = await mirror.get<{ contract_id: string }>(`/contracts/${contract}`);
  if (!record) return null;
  const createdHere = (logs: MirrorLog[]) =>
    logs.some(log => {
      const event = decodePlanLog(log);
      return event?.type === "PlanCreated" && event.planId === planId;
    });
  const { items, truncated } = await mirror.pages<MirrorLog>(
    `/contracts/${contract}/results/logs?order=desc&limit=100`,
    "logs",
    maxPages,
    planId === undefined ? undefined : createdHere,
  );
  const events = items.reverse().flatMap(log => decodePlanLog(log) ?? []);
  return { contractId: record.contract_id, events, truncated };
}

/** Ids of the plans `owner` created, newest first. */
export const plansOwnedBy = (events: PlanEvent[], owner: Address): bigint[] =>
  events
    .filter(event => event.type === "PlanCreated" && isAddressEqual(event.owner, owner))
    .map(event => event.planId)
    .reverse();

/** The plan's history and chain status; null when `events` has no PlanCreated for it. */
export async function resolvePlan(
  mirror: Mirror,
  { contractId, events }: Pick<ContractEvents, "contractId" | "events">,
  planId: bigint,
  nowSeconds: number,
): Promise<PlanView | null> {
  const own = events.filter(event => event.planId === planId);
  const created = own.find(event => event.type === "PlanCreated");
  if (created?.type !== "PlanCreated") return null;

  const outcomeTicks = new Set(
    own.flatMap(event => {
      if (event.type === "TickExecuted" || event.type === "TickSkipped") return [event.tick];
      if (event.type === "PlanStopped" && event.reason === "PullFailed") return [event.ticksDone];
      return [];
    }),
  );
  const open = own.filter(event => event.type === "TickScheduled" && !outcomeTicks.has(event.tick));
  const lookups: Record<string, ScheduleLookup> = {};
  await Promise.all(
    open.map(async event => {
      if (event.type !== "TickScheduled") return;
      const record = await mirror.get<MirrorSchedule>(`/schedules/${event.scheduleId}`);
      const state = record ? scheduleState(record, nowSeconds) : null;
      let revert: string | null = null;
      if (record?.executed_timestamp) {
        const execution = await fetchExecution(mirror, contractId, record.executed_timestamp);
        if (execution && execution.result !== "SUCCESS") revert = describeRevert(execution.error_message);
      }
      lookups[event.scheduleId] = { record, state, revert };
    }),
  );

  const ticks = buildTicks(own, lookups);
  const sum = (type: "GasDepositAdded" | "GasRefunded") =>
    own.reduce((total, event) => (event.type === type ? total + event.amount : total), 0n);
  return {
    planId,
    owner: getAddress(created.owner),
    params: created.params,
    deposit: created.deposit,
    createdAt: created.timestamp,
    ticks,
    status: chainStatus(own, ticks),
    toppedUp: sum("GasDepositAdded"),
    refunded: sum("GasRefunded"),
  };
}
