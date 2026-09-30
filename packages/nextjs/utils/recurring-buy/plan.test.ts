// Events here are encoded with the template's ABI, because the prototype's contract emitted other events. The
// schedules and executions they point at are real testnet records from the prototype runs (docs/testnet-findings.md,
// see mirror.test.ts): run B's negative control, a tick that reverted as a whole, and run A's expired schedule (S4).
import { recurringBuyAbi } from "./abi";
import contractRecord from "./fixtures/contract-prototype.json";
import prototypeLogs from "./fixtures/logs-prototype.json";
import negativeByTimestamp from "./fixtures/result-negative-by-timestamp.json";
import expiredSchedule from "./fixtures/schedule-0.0.10702201-expired.json";
import negativeSchedule from "./fixtures/schedule-0.0.10777841-negative.json";
import { MISSED_AFTER_SECONDS, type MirrorLog, type MirrorSchedule } from "./mirror";
import {
  BELOW_FLOOR_REASON,
  type PlanEvent,
  buildTicks,
  chainStatus,
  decodePlanLog,
  loadContractEvents,
  plansOwnedBy,
  resolvePlan,
} from "./plan";
import { fixtureMirror } from "./testing";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AbiEvent,
  type Address,
  type Hex,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  parseAbi,
} from "viem";

const CONTRACT = getAddress(contractRecord.evm_address);
const CONTRACT_ID = contractRecord.contract_id;
const ALICE = getAddress("0x0fc1c36d000000000000000000000000000009a0");
const BOB = getAddress("0x0000000000000000000000000000000000000b0b");
const WHBAR = getAddress("0x0000000000000000000000000000000000003ad2");
const SAUCE = getAddress("0x0000000000000000000000000000000000120f46");

const PARAMS = {
  tokenIn: WHBAR,
  fee: 3000,
  tokenOut: SAUCE,
  amountPerTick: 5_000_000n,
  minAmountOut: 1_943_793n,
  period: 90n,
  maxTicks: 3n,
  tickGasLimit: 1_900_000n,
};

/** A mirror node log entry for a RecurringBuy event. */
function logOf(eventName: string, args: Record<string, unknown>, timestamp: string): MirrorLog {
  const event = getAbiItem({ abi: recurringBuyAbi, name: eventName as "PlanCreated" }) as AbiEvent;
  const indexed = Object.fromEntries(event.inputs.filter(i => i.indexed).map(i => [i.name!, args[i.name!]]));
  const nonIndexed = event.inputs.filter(i => !i.indexed);
  return {
    address: CONTRACT,
    topics: encodeEventTopics({ abi: [event], eventName, args: indexed } as never) as Hex[],
    data: encodeAbiParameters(
      nonIndexed,
      nonIndexed.map(i => args[i.name!]),
    ),
    timestamp,
  };
}

const scheduleAddress = (scheduleId: string) =>
  `0x${BigInt(scheduleId.split(".")[2]).toString(16).padStart(40, "0")}` as Address;

const created = (planId: bigint, owner: Address, timestamp: string) =>
  logOf("PlanCreated", { planId, owner, params: PARAMS, deposit: 3n * 433_200_000n }, timestamp);
const scheduled = (planId: bigint, tickNumber: number, scheduleId: string, expirySecond: number, timestamp: string) =>
  logOf("TickScheduled", { planId, tickNumber, schedule: scheduleAddress(scheduleId), expirySecond }, timestamp);

const tooLittleReceived = encodeErrorResult({
  abi: parseAbi(["error Error(string)"]),
  errorName: "Error",
  args: [BELOW_FLOOR_REASON],
});

const decodeAll = (logs: MirrorLog[]) => logs.map(log => decodePlanLog(log)).filter(e => e !== null) as PlanEvent[];

describe("decodePlanLog", () => {
  it("decodes every RecurringBuy event", () => {
    const events = decodeAll([
      created(1n, ALICE, "100.0"),
      scheduled(1n, 1, "0.0.500", 190, "100.0"),
      logOf("TickExecuted", { planId: 1n, tickNumber: 1, amountIn: 5_000_000n, amountOut: 2_046_098n }, "190.1"),
      logOf("TickSkipped", { planId: 1n, tickNumber: 2, reason: tooLittleReceived }, "280.1"),
      logOf("PlanStopped", { planId: 1n, ticksDone: 3, reason: 2, hssResponseCode: 0 }, "370.1"),
      logOf("GasDepositAdded", { planId: 1n, amount: 7n }, "120.0"),
      logOf("GasRefunded", { planId: 1n, to: BOB, amount: 9n }, "400.0"),
    ]);
    assert.deepEqual(
      events.map(e => e.type),
      ["PlanCreated", "TickScheduled", "TickExecuted", "TickSkipped", "PlanStopped", "GasDepositAdded", "GasRefunded"],
    );
    const [plan, tick] = events;
    assert.equal(plan.type === "PlanCreated" && plan.owner, ALICE);
    assert.deepEqual(plan.type === "PlanCreated" && plan.params, PARAMS);
    assert.equal(tick.type === "TickScheduled" && tick.scheduleId, "0.0.500");
    assert.equal(events[4].type === "PlanStopped" && events[4].reason, "PullFailed");
  });

  it("ignores logs of other contracts and other event signatures", () => {
    // The prototype's contract emitted Ticked/Scheduled/Stopped, which RecurringBuy does not have.
    assert.equal(prototypeLogs.logs.length, 8);
    assert.deepEqual(decodeAll(prototypeLogs.logs as MirrorLog[]), []);
  });
});

describe("buildTicks and chainStatus", () => {
  it("shows bought and skipped ticks and waits for the next one", () => {
    const events = decodeAll([
      created(1n, ALICE, "100.0"),
      scheduled(1n, 1, "0.0.501", 190, "100.0"),
      logOf("TickExecuted", { planId: 1n, tickNumber: 1, amountIn: 5_000_000n, amountOut: 2_046_098n }, "190.1"),
      scheduled(1n, 2, "0.0.502", 280, "190.1"),
      logOf("TickSkipped", { planId: 1n, tickNumber: 2, reason: tooLittleReceived }, "280.1"),
      scheduled(1n, 3, "0.0.503", 370, "280.1"),
    ]);
    const waiting: MirrorSchedule = {
      schedule_id: "0.0.503",
      executed_timestamp: null,
      expiration_time: "370.0",
      deleted: false,
    };
    const ticks = buildTicks(events, { "0.0.503": { record: waiting, state: "waiting", revert: null } });
    assert.deepEqual(
      ticks.map(t => [t.tick, t.scheduleId, t.due, t.outcome.kind]),
      [
        [1, "0.0.501", 190, "bought"],
        [2, "0.0.502", 280, "skipped"],
        [3, "0.0.503", 370, "waiting"],
      ],
    );
    assert.equal(ticks[1].outcome.kind === "skipped" && ticks[1].outcome.reason, BELOW_FLOOR_REASON);
    assert.deepEqual(chainStatus(events, ticks), { kind: "running", tick: 3, due: 370 });
  });

  it("ends the plan at the tick whose pull failed", () => {
    const events = decodeAll([
      created(1n, ALICE, "100.0"),
      scheduled(1n, 1, "0.0.501", 190, "100.0"),
      logOf("PlanStopped", { planId: 1n, ticksDone: 1, reason: 2, hssResponseCode: 0 }, "190.1"),
    ]);
    const ticks = buildTicks(events, {});
    assert.deepEqual(ticks[0].outcome, { kind: "pull-failed", timestamp: "190.1" });
    assert.equal(chainStatus(events, ticks).kind, "stopped");
  });
});

describe("chainStatus after the owner stops", () => {
  const executed = (timestamp: string): MirrorSchedule => ({
    schedule_id: "0.0.501",
    executed_timestamp: timestamp,
    expiration_time: "190.0",
    deleted: false,
  });
  const stoppedPlan = (stopAt: string) =>
    decodeAll([
      created(1n, ALICE, "100.0"),
      scheduled(1n, 1, "0.0.501", 190, "100.0"),
      // deleteSchedule returned 201 (INVALID_SCHEDULE_ID): the schedule had already run.
      logOf("PlanStopped", { planId: 1n, ticksDone: 0, reason: 1, hssResponseCode: 201 }, stopAt),
    ]);

  it("says the chain had already broken when the last tick reverted before the stop", () => {
    const events = stoppedPlan("250.0");
    const ticks = buildTicks(events, {
      "0.0.501": { record: executed("190.1"), state: "executed", revert: "no reason given; for example, out of gas" },
    });
    const status = chainStatus(events, ticks);
    assert.equal(status.kind === "stopped" && status.brokenAt, 1);
  });

  it("does not blame the chain for a pending tick that ran after the stop", () => {
    const events = stoppedPlan("150.0");
    const ticks = buildTicks(events, {
      "0.0.501": { record: executed("190.1"), state: "executed", revert: "PlanNotActive(1)" },
    });
    const status = chainStatus(events, ticks);
    assert.equal(status.kind === "stopped" && status.brokenAt, null);
  });
});

describe("resolvePlan on real schedule records", () => {
  it("calls a plan broken when its last tick reverted as a whole, whatever the contract's flag says", async () => {
    // Run B's negative control: the allowance was 0, the tick reverted without a reason and took its bookkeeping
    // along, so the contract still reported the plan active with ticksDone 0.
    const events = decodeAll([
      created(1n, ALICE, "1790691471.337917655"),
      scheduled(1n, 1, "0.0.10777841", 1790691529, "1790691471.337917655"),
    ]);
    const { mirror, requested } = fixtureMirror({
      "/schedules/0.0.10777841": negativeSchedule,
      [`/contracts/${CONTRACT_ID}/results/1790691529.110199928`]: negativeByTimestamp,
    });
    const plan = await resolvePlan(mirror, { contractId: CONTRACT_ID, events }, 1n, 1790691600);
    assert.deepEqual(plan?.ticks[0].outcome, {
      kind: "reverted",
      timestamp: "1790691529.110199928",
      reason: "no reason given; for example, out of gas",
    });
    assert.deepEqual(plan?.status, {
      kind: "broken",
      tick: 1,
      detail: "it reverted (no reason given; for example, out of gas)",
    });
    assert.ok(requested.every(p => !p.includes("nonce")));
  });

  it("calls a plan broken when Hedera never ran its schedule, and waiting before that", async () => {
    const expiry = Number(expiredSchedule.expiration_time.split(".")[0]);
    const events = decodeAll([
      created(2n, BOB, "1790274500.0"),
      scheduled(2n, 1, expiredSchedule.schedule_id, expiry, "1790274500.0"),
    ]);
    const { mirror } = fixtureMirror({ [`/schedules/${expiredSchedule.schedule_id}`]: expiredSchedule });
    const before = await resolvePlan(mirror, { contractId: CONTRACT_ID, events }, 2n, expiry - 5);
    assert.deepEqual(before?.status, { kind: "running", tick: 1, due: expiry });
    const after = await resolvePlan(mirror, { contractId: CONTRACT_ID, events }, 2n, expiry + MISSED_AFTER_SECONDS + 1);
    assert.deepEqual(after?.status, { kind: "broken", tick: 1, detail: "Hedera did not run its schedule" });
  });

  it("returns null for a plan id with no PlanCreated", async () => {
    const { mirror } = fixtureMirror({});
    assert.equal(await resolvePlan(mirror, { contractId: CONTRACT_ID, events: [] }, 7n, 0), null);
  });
});

describe("loadContractEvents and plansOwnedBy", () => {
  it("reads the contract's logs newest page first and returns them oldest first", async () => {
    const logs = [created(1n, ALICE, "100.0"), created(2n, BOB, "110.0"), created(3n, ALICE, "120.0")].reverse();
    const { mirror, requested } = fixtureMirror({
      [`/contracts/${CONTRACT}`]: contractRecord,
      [`/contracts/${CONTRACT}/results/logs?order=desc&limit=100`]: { logs, links: { next: null } },
    });
    const loaded = await loadContractEvents(mirror, CONTRACT);
    assert.equal(loaded?.contractId, CONTRACT_ID);
    assert.deepEqual(
      loaded?.events.map(e => e.planId),
      [1n, 2n, 3n],
    );
    assert.deepEqual(plansOwnedBy(loaded!.events, ALICE), [3n, 1n]);
    assert.deepEqual(requested, [`/contracts/${CONTRACT}`, `/contracts/${CONTRACT}/results/logs?order=desc&limit=100`]);
  });

  it("stops paging at the page with the plan's PlanCreated", async () => {
    const logsPath = `/contracts/${CONTRACT}/results/logs?order=desc&limit=100`;
    const page2 = `${logsPath}&timestamp=lt:200.0`;
    const page3 = `${logsPath}&timestamp=lt:100.0`;
    const { mirror, requested } = fixtureMirror({
      [`/contracts/${CONTRACT}`]: contractRecord,
      [logsPath]: { logs: [scheduled(1n, 2, "0.0.502", 390, "300.0")], links: { next: `/api/v1${page2}` } },
      [page2]: {
        logs: [scheduled(1n, 1, "0.0.501", 290, "200.0"), created(1n, ALICE, "200.0")],
        links: { next: `/api/v1${page3}` },
      },
      [page3]: { logs: [created(0n, BOB, "100.0")], links: { next: null } },
    });
    const loaded = await loadContractEvents(mirror, CONTRACT, { planId: 1n });
    assert.equal(loaded?.truncated, false);
    assert.deepEqual(
      loaded?.events.map(e => e.type),
      ["PlanCreated", "TickScheduled", "TickScheduled"],
    );
    assert.ok(!requested.includes(page3));
    // Without a plan id every page is read.
    assert.equal((await loadContractEvents(mirror, CONTRACT))?.events.length, 4);
  });

  it("returns null when the mirror node does not know the contract", async () => {
    const { mirror } = fixtureMirror({});
    assert.equal(await loadContractEvents(mirror, CONTRACT), null);
  });
});
