import type { Hex } from "viem";

// Mirror node REST records, only the fields the app reads. Checked against testnet responses for the prototype run
// (docs/testnet-findings.md, run B); utils/recurring-buy/fixtures holds those responses.

export type MirrorLog = {
  address: string;
  data: Hex;
  topics: Hex[];
  /** Consensus timestamp of the transaction that emitted it, "seconds.nanos". */
  timestamp: string;
};

export type MirrorSchedule = {
  schedule_id: string;
  /** Null until Hedera runs the schedule, and stays null after it expires unexecuted. */
  executed_timestamp: string | null;
  expiration_time: string;
  deleted: boolean;
};

/** /contracts/{id}/results/{timestamp}: one EVM execution. */
export type MirrorContractResult = {
  timestamp: string;
  result: string;
  contract_id: string | null;
  error_message: Hex | null;
};

/** /transactions?timestamp=…: the record of one transaction, with the HBAR it moved. */
export type MirrorTransaction = {
  consensus_timestamp: string;
  /** For a scheduled tick this inherits the relay's id and nonce from the call that created the schedule. */
  transaction_id: string;
  nonce: number;
  result: string;
  scheduled: boolean;
  charged_tx_fee: number;
  transfers: { account: string; amount: number }[];
};

export type Mirror = {
  /** The JSON at `path` (under /api/v1), or null on 404. */
  get<T>(path: string): Promise<T | null>;
  /**
   * Every item under `key` of a paged list, following links.next up to `maxPages` pages, or until `done` returns true
   * for a page's items.
   */
  pages<T>(
    path: string,
    key: string,
    maxPages: number,
    done?: (page: T[]) => boolean,
  ): Promise<{ items: T[]; truncated: boolean }>;
};

/** `baseUrl` ends in /api/v1, as ENDPOINTS.<network>.mirrorUrl in @sh/saucerswap. */
export function createMirror(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): Mirror {
  const origin = new URL(baseUrl).origin;
  const getUrl = async <T>(url: string): Promise<T | null> => {
    const res = await fetchImpl(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`mirror node ${url}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    get: path => getUrl(baseUrl + path),
    async pages<T>(path: string, key: string, maxPages: number, done?: (page: T[]) => boolean) {
      const items: T[] = [];
      let url: string | null = baseUrl + path;
      for (let page = 0; url && page < maxPages; page++) {
        const body: Record<string, unknown> | null = await getUrl(url);
        const pageItems: T[] = (body?.[key] as T[] | undefined) ?? [];
        items.push(...pageItems);
        const next: string | null | undefined = (body?.links as { next?: string | null } | undefined)?.next;
        url = next && !done?.(pageItems) ? origin + next : null;
      }
      return { items, truncated: url !== null };
    },
  };
}

/** "0.0.N" of a schedule, token or contract from its long-zero EVM address. */
export const hederaIdOf = (longZeroAddress: string) => `0.0.${BigInt(longZeroAddress)}`;

export type ScheduleState = "waiting" | "due" | "missed" | "executed" | "deleted";

/**
 * How long past its expiry second a schedule may show no execution before it counts as missed. Hedera ran the
 * prototype's ticks 0.04-0.17 s after expiry; the rest is mirror node indexing delay.
 */
export const MISSED_AFTER_SECONDS = 60;

/**
 * The state of a schedule from its mirror record. The mirror node never marks a schedule as expired: one Hedera did not
 * run keeps `executed_timestamp: null` and `deleted: false` forever (docs/testnet-findings.md, A7), so "missed" is computed here
 * from the clock.
 */
export function scheduleState(schedule: MirrorSchedule, nowSeconds: number): ScheduleState {
  if (schedule.executed_timestamp) return "executed";
  if (schedule.deleted) return "deleted";
  const expiry = Number(schedule.expiration_time.split(".")[0]);
  if (nowSeconds <= expiry) return "waiting";
  return nowSeconds > expiry + MISSED_AFTER_SECONDS ? "missed" : "due";
}

/**
 * The execution a schedule ran, read by its consensus timestamp under the contract that ran it. Not by
 * `/contracts/results/{transactionId}?nonce=N`: a scheduled tick inherits the transaction id and nonce of the HIP-1215
 * call that created its schedule, so that URL can return the scheduling call instead (docs/testnet-findings.md, B7). Not by
 * `/contracts/results?timestamp=…` either: that list hides a scheduled call unless `internal=true` is passed.
 */
export async function fetchExecution(
  mirror: Mirror,
  contractId: string,
  executedTimestamp: string,
): Promise<MirrorContractResult | null> {
  const record = await mirror.get<MirrorContractResult>(`/contracts/${contractId}/results/${executedTimestamp}`);
  if (!record) return null;
  if (record.contract_id !== contractId || record.timestamp !== executedTimestamp) {
    throw new Error(
      `mirror node returned ${record.contract_id}@${record.timestamp} for ${contractId}@${executedTimestamp}`,
    );
  }
  return record;
}

/**
 * Tinybar `payer` paid for a transaction, from its transfers. For a tick this is the contract: the schedule's payer.
 * The tick's `transaction_id`, and the `from` of its contract result, name the hashio relay that sent the call which
 * created the schedule; it paid nothing.
 */
export function paidBy(transaction: MirrorTransaction, payer: string): bigint {
  return transaction.transfers
    .filter(transfer => transfer.account === payer && transfer.amount < 0)
    .reduce((sum, transfer) => sum - BigInt(transfer.amount), 0n);
}

/** What the contract paid for the tick executed at `timestamp`, or null when the mirror has no record of it yet. */
export async function fetchTickCharge(mirror: Mirror, contractId: string, timestamp: string): Promise<bigint | null> {
  const found = await mirror.get<{ transactions: MirrorTransaction[] }>(`/transactions?timestamp=${timestamp}`);
  const transaction = found?.transactions.find(t => t.consensus_timestamp === timestamp);
  return transaction ? paidBy(transaction, contractId) : null;
}
