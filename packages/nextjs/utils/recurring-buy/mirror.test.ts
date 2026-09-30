// Fixtures are testnet mirror node responses for objects of the two prototype runs (docs/testnet-findings.md),
// fetched 2026-09-29, and network-fees.json, /network/fees of 2026-09-30. contract-prototype.json keeps four fields of
// /contracts/0.0.10777783; every other file is the full response body.
import networkFees from "./fixtures/network-fees.json";
import negativeByNonce from "./fixtures/result-negative-by-nonce.json";
import negativeByTimestamp from "./fixtures/result-negative-by-timestamp.json";
import tick1ByTimestamp from "./fixtures/result-tick1-by-timestamp.json";
import expiredSchedule from "./fixtures/schedule-0.0.10702201-expired.json";
import tick1Schedule from "./fixtures/schedule-0.0.10777792-tick1.json";
import tick1Transactions from "./fixtures/transactions-tick1.json";
import {
  MISSED_AFTER_SECONDS,
  createMirror,
  fetchExecution,
  fetchGasPrice,
  fetchTickCharge,
  paidBy,
  scheduleState,
} from "./mirror";
import { TESTNET_MIRROR, fixtureMirror } from "./testing";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PROTOTYPE_CONTRACT = "0.0.10777783";
const HASHIO_RELAY = "0.0.7314364";
const NEGATIVE_TICK = "1790691529.110199928";
const TICK1 = "1790691317.164542146";

describe("scheduleState", () => {
  it("reads an executed schedule as executed", () => {
    assert.equal(scheduleState(tick1Schedule, 1790691400), "executed");
  });

  it("computes expiry itself: the mirror node shows an expired schedule like a waiting one", () => {
    // Run A, S4: never signed, expired at 1790274645. Days later the record still reads as open.
    assert.equal(expiredSchedule.executed_timestamp, null);
    assert.equal(expiredSchedule.deleted, false);
    const expiry = 1790274645;
    assert.equal(scheduleState(expiredSchedule, expiry - 10), "waiting");
    assert.equal(scheduleState(expiredSchedule, expiry + 30), "due");
    assert.equal(scheduleState(expiredSchedule, expiry + MISSED_AFTER_SECONDS + 1), "missed");
  });

  it("reads a deleted schedule as deleted", () => {
    assert.equal(scheduleState({ ...expiredSchedule, deleted: true }, 1790274645 - 10), "deleted");
  });
});

describe("fetchExecution", () => {
  it("reads a tick by its timestamp under the contract, not by transaction id and nonce", async () => {
    const byTimestamp = `/contracts/${PROTOTYPE_CONTRACT}/results/${NEGATIVE_TICK}`;
    const { mirror, requested } = fixtureMirror({ [byTimestamp]: negativeByTimestamp });
    const execution = await fetchExecution(mirror, PROTOTYPE_CONTRACT, NEGATIVE_TICK);
    assert.equal(execution?.result, "CONTRACT_REVERT_EXECUTED");
    assert.equal(execution?.error_message, "0x");
    assert.deepEqual(requested, [byTimestamp]);
  });

  it("rejects a record for another execution, like the one the ambiguous nonce URL returns", async () => {
    // The negative tick's transaction id and nonce 53 are shared with the start() call that scheduled it: that URL
    // answers with the HSS scheduleCall, a successful call to 0x…16b a minute earlier.
    assert.equal(negativeByNonce.contract_id, "0.0.363");
    assert.equal(negativeByNonce.result, "SUCCESS");
    const { mirror } = fixtureMirror({
      [`/contracts/${PROTOTYPE_CONTRACT}/results/${NEGATIVE_TICK}`]: negativeByNonce,
    });
    await assert.rejects(fetchExecution(mirror, PROTOTYPE_CONTRACT, NEGATIVE_TICK), /returned 0\.0\.363@1790691471/);
  });

  it("returns null when the mirror node has no such execution", async () => {
    const { mirror } = fixtureMirror({});
    assert.equal(await fetchExecution(mirror, PROTOTYPE_CONTRACT, NEGATIVE_TICK), null);
  });
});

describe("tick charge", () => {
  it("takes what the contract paid, not the relay the mirror node names as sender", async () => {
    // A scheduled tick's `from` and transaction id both point at the hashio relay, which paid nothing.
    assert.equal(BigInt(tick1ByTimestamp.from), BigInt(0x6f9bbc));
    assert.equal(`0.0.${0x6f9bbc}`, HASHIO_RELAY);
    const [transaction] = tick1Transactions.transactions;
    assert.ok(transaction.transaction_id.startsWith(`${HASHIO_RELAY}-`));
    assert.equal(paidBy(transaction, HASHIO_RELAY), 0n);

    const { mirror, requested } = fixtureMirror({ [`/transactions?timestamp=${TICK1}`]: tick1Transactions });
    assert.equal(await fetchTickCharge(mirror, PROTOTYPE_CONTRACT, TICK1), 176_896_536n);
    assert.deepEqual(requested, [`/transactions?timestamp=${TICK1}`]);
  });
});

describe("createMirror", () => {
  it("follows links.next and reports truncation", async () => {
    const page = (n: number, next: string | null) => ({ logs: [{ n }], links: { next } });
    const { mirror } = fixtureMirror({
      "/a?limit=1": page(1, "/api/v1/a?limit=1&timestamp=lt:2"),
      "/a?limit=1&timestamp=lt:2": page(2, "/api/v1/a?limit=1&timestamp=lt:1"),
      "/a?limit=1&timestamp=lt:1": page(3, null),
    });
    assert.deepEqual(await mirror.pages("/a?limit=1", "logs", 5), {
      items: [{ n: 1 }, { n: 2 }, { n: 3 }],
      truncated: false,
    });
    assert.deepEqual(await mirror.pages("/a?limit=1", "logs", 2), { items: [{ n: 1 }, { n: 2 }], truncated: true });
  });

  it("throws on an error status other than 404", async () => {
    const { mirror } = fixtureMirror({});
    assert.equal(await mirror.get("/missing"), null);
    const failing = (async () => new Response("", { status: 503 })) as typeof fetch;
    await assert.rejects(createMirror(TESTNET_MIRROR, failing).get("/schedules/0.0.1"), /HTTP 503/);
  });
});

describe("fetchGasPrice", () => {
  it("reads the tinybar per gas the network bills from /network/fees", async () => {
    const { mirror, requested } = fixtureMirror({ "/network/fees": networkFees });
    assert.deepEqual(await fetchGasPrice(mirror), { contractCall: 109n, ethereumTransaction: 109n });
    assert.deepEqual(requested, ["/network/fees"]);
  });

  it("fails when a transaction type has no price", async () => {
    const fees = networkFees.fees.filter(fee => fee.transaction_type !== "ContractCall");
    const { mirror } = fixtureMirror({ "/network/fees": { ...networkFees, fees } });
    await assert.rejects(fetchGasPrice(mirror), /ContractCall/);
  });
});
