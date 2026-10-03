"use client";

import { CumulativeChart } from "./CumulativeChart";
import { FlowDiagram } from "./FlowDiagram";
import {
  ExternalLink,
  Linked,
  formatAmount,
  formatClock,
  formatDay,
  formatHbar,
  formatPeriod,
  formatRemaining,
  formatTime,
  formatToken,
  shortAddress,
  useNow,
} from "./common";
import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import {
  type RecurringBuyNetwork,
  type TokenInfo,
  useContractId,
  useTickCharges,
  useTokenInfo,
} from "~~/hooks/recurring-buy/useRecurringBuy";
import { recurringBuyAbi } from "~~/utils/recurring-buy/abi";
import { boughtTotals } from "~~/utils/recurring-buy/chart";
import {
  BELOW_FLOOR_REASON,
  type ChainStatus,
  type PlanView,
  type TickRow,
  tickTime,
  ticksRun,
} from "~~/utils/recurring-buy/plan";

type Tokens = { in: TokenInfo | null | undefined; out: TokenInfo | null | undefined };

const STATUS_BADGE: Record<ChainStatus["kind"], [string, string]> = {
  running: ["badge-success badge-soft text-base-content", "Running"],
  due: ["badge-info badge-soft", "Buying now"],
  stopped: ["badge-error badge-soft", "Stopped"],
  broken: ["badge-error", "Chain broken"],
  indexing: ["badge-ghost", "Syncing"],
};

export const StatusBadge = ({ status }: { status: ChainStatus }) => {
  const [style, label] =
    status.kind === "stopped" && status.reason === "Completed"
      ? ["badge-success badge-soft text-base-content", "Completed"]
      : STATUS_BADGE[status.kind];
  return <span className={`badge ${style}`}>{label}</span>;
};

function stopMessage(status: Extract<ChainStatus, { kind: "stopped" }>): string {
  switch (status.reason) {
    case "Completed":
      return `Completed: all ${status.ticksDone} ticks ran.`;
    case "StoppedByOwner":
      if (status.hssResponseCode === 22) {
        return "Stopped by the owner. Hedera deleted the pending tick's schedule, so its reservation went back to the deposit.";
      }
      return status.brokenAt !== null
        ? `Stopped by the owner after the chain broke at tick ${status.brokenAt}: nothing was pending, so that tick's reservation was not refunded.`
        : `Stopped by the owner. Hedera did not delete the pending schedule (response ${status.hssResponseCode}); it will run and revert without buying.`;
    case "PullFailed":
      return `Stopped at tick ${status.ticksDone}: the allowance or the token balance could not cover a buy.`;
    case "GasDepositExhausted":
      return "Stopped: the gas deposit could not reserve another tick.";
    case "ScheduleFailed":
      return `Stopped: Hedera refused to schedule the next tick (response ${status.hssResponseCode}).`;
  }
}

const ChainLine = ({ status, now }: { status: ChainStatus; now: number }) => {
  switch (status.kind) {
    case "running":
      return (
        <p className="m-0">
          Next tick <b>#{status.tick}</b> in{" "}
          <b className="tabular-nums" data-testid="countdown">
            {formatRemaining(status.due - now)}
          </b>{" "}
          <span className="text-base-content/60">({formatTime(status.due)})</span>
        </p>
      );
    case "due":
      return (
        <p className="m-0">
          Tick <b>#{status.tick}</b> is due: Hedera runs it at its second, and the mirror node shows the result a few
          seconds later.
        </p>
      );
    case "stopped":
      return <p className="m-0">{stopMessage(status)}</p>;
    case "broken":
      return (
        <p className="m-0 text-error">
          Tick #{status.tick} did not complete: {status.detail}. Nothing is scheduled after it, so no more buys will
          run. The owner can call stop to recover the gas deposit.
        </p>
      );
    case "indexing":
      return <p className="m-0 text-base-content/60">Waiting for the mirror node to index the latest tick.</p>;
  }
};

export const OUTCOME_BADGE: Record<TickRow["outcome"]["kind"], [string, string]> = {
  bought: ["badge-success badge-soft text-base-content", "Bought"],
  skipped: ["badge-warning badge-soft text-base-content", "Skipped"],
  "pull-failed": ["badge-error badge-soft", "Pull failed"],
  reverted: ["badge-error badge-soft", "Reverted"],
  waiting: ["badge-info badge-soft", "Scheduled"],
  due: ["badge-info badge-soft", "Due"],
  missed: ["badge-error badge-soft", "Missed"],
  cancelled: ["badge-ghost", "Cancelled"],
  indexing: ["badge-ghost", "Indexing"],
};

function outcomeText(row: TickRow, plan: PlanView, tokens: Tokens, now: number): string {
  const { outcome } = row;
  switch (outcome.kind) {
    case "bought":
      return `${formatToken(outcome.amountIn, plan.params.tokenIn, tokens.in)} → ${formatToken(outcome.amountOut, plan.params.tokenOut, tokens.out)}`;
    case "skipped":
      return outcome.reason === BELOW_FLOOR_REASON
        ? "Price below the floor. Nothing was taken."
        : `The swap failed (${outcome.reason}). Nothing was taken.`;
    case "pull-failed":
      return "Allowance or balance too low. The plan stopped.";
    case "reverted":
      return outcome.reason.startsWith("PlanNotActive")
        ? "Did not run: the plan was already stopped."
        : `The whole tick reverted (${outcome.reason}).`;
    case "waiting":
      return row.due === null ? "" : `In ${formatRemaining(row.due - now)}`;
    case "due":
      return "Hedera is running it.";
    case "missed":
      return "Hedera did not run it.";
    case "cancelled":
      return "Deleted when the plan was stopped.";
    case "indexing":
      return "Waiting for the mirror node.";
  }
}

const executedAt = (row: TickRow) => ("timestamp" in row.outcome && row.outcome.timestamp) || null;

/** A token amount rounded for reading; while the token is unknown, the raw amount and its id. */
const amountOf = (value: bigint, token: string, info: TokenInfo | null | undefined) =>
  info ? `${formatAmount(value, info.decimals)} ${info.symbol}` : formatToken(value, token, info);

const TickTable = ({ plan, network, tokens }: { plan: PlanView; network: RecurringBuyNetwork; tokens: Tokens }) => {
  const now = useNow();
  const { data: contractId } = useContractId(network);
  const timestamps = plan.ticks.flatMap(row => executedAt(row) ?? []);
  const charges = useTickCharges(network, contractId, timestamps);
  const { explorer } = network;
  const times = plan.ticks.flatMap(row => tickTime(row) ?? []);
  const oneDay = new Set(times.map(formatDay)).size === 1;

  return (
    <div className="overflow-x-auto">
      <table className="table table-xs sm:table-sm">
        <thead>
          <tr className="bg-base-200">
            <th className="w-10">#</th>
            <th>
              Time
              {oneDay && times.length > 0 && <span className="hidden sm:inline"> ({formatDay(times[0])})</span>}
            </th>
            <th>Status</th>
            <th className="hidden md:table-cell">Swap</th>
            <th className="hidden lg:table-cell text-right">Gas (HBAR)</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {[...plan.ticks].reverse().map(row => {
            const [style, label] = OUTCOME_BADGE[row.outcome.kind];
            const at = executedAt(row);
            const time = tickTime(row);
            return (
              <tr key={row.tick} data-testid="tick-row">
                <td className="tabular-nums">{row.tick}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {time === null ? "—" : oneDay ? formatClock(time) : `${formatDay(time)}, ${formatClock(time)}`}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`badge badge-sm ${style}`}>{label}</span>
                    {row.outcome.kind === "bought" ? (
                      <span className="md:hidden whitespace-nowrap tabular-nums">
                        {amountOf(row.outcome.amountOut, plan.params.tokenOut, tokens.out)}
                      </span>
                    ) : (
                      <span className="sm:text-sm">{outcomeText(row, plan, tokens, now)}</span>
                    )}
                  </div>
                </td>
                <td className="hidden md:table-cell whitespace-nowrap tabular-nums">
                  {row.outcome.kind === "bought"
                    ? `${amountOf(row.outcome.amountIn, plan.params.tokenIn, tokens.in)} → ${amountOf(row.outcome.amountOut, plan.params.tokenOut, tokens.out)}`
                    : "—"}
                </td>
                <td className="hidden lg:table-cell text-right tabular-nums whitespace-nowrap">
                  {at && charges[at] !== undefined ? formatAmount(charges[at], 8) : "—"}
                </td>
                <td>
                  <div className="flex flex-col sm:flex-row sm:gap-2 whitespace-nowrap">
                    {explorer && at && <Linked href={`${explorer}/transaction/${at}`}>tx</Linked>}
                    {explorer && row.scheduleId && (
                      <Linked href={`${explorer}/schedule/${row.scheduleId}`}>schedule</Linked>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Fact = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5 min-w-0">
    <h4 className="m-0 font-bold text-sm">{title}</h4>
    {children}
  </div>
);

/** A plan's terms, its chain of ticks as the mirror node shows it, and its state in the contract. */
export const PlanDetails = ({
  plan,
  network,
  actions,
  showTitle = true,
}: {
  plan: PlanView;
  network: RecurringBuyNetwork;
  actions?: React.ReactNode;
  /** Off where the caller already shows the plan's number and status. */
  showTitle?: boolean;
}) => {
  const now = useNow();
  const { params, status } = plan;
  const tokens: Tokens = {
    in: useTokenInfo(network, params.tokenIn).data,
    out: useTokenInfo(network, params.tokenOut).data,
  };
  const { data: onChain } = useReadContract({
    address: network.contract,
    abi: recurringBuyAbi,
    functionName: "plans",
    args: [plan.planId],
    chainId: network.chainId,
    query: { enabled: Boolean(network.contract), refetchInterval: 30_000 },
  });

  const bought = plan.ticks.filter(row => row.outcome.kind === "bought").length;
  const { spent, received } = boughtTotals(plan.ticks);
  const average =
    tokens.in && tokens.out && spent > 0n
      ? Number(formatUnits(received, tokens.out.decimals)) / Number(formatUnits(spent, tokens.in.decimals))
      : null;
  const { explorer } = network;
  const amountIn = (value: bigint) => amountOf(value, params.tokenIn, tokens.in);
  const amountOut = (value: bigint) => amountOf(value, params.tokenOut, tokens.out);

  return (
    <div className="flex flex-col gap-4">
      {showTitle && (
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-bold text-xl m-0">Plan #{plan.planId.toString()}</h3>
          <StatusBadge status={status} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="grow rounded-xl bg-primary/5 border border-primary/10 px-4 py-2.5 text-sm">
          <ChainLine status={status} now={now} />
          {status.kind === "broken" && onChain?.active && (
            <p className="m-0 mt-1 text-base-content/70">
              The contract still reports this plan as active: a tick that reverts as a whole also undoes its own
              bookkeeping. This status comes from the last schedule&apos;s execution instead.
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      <FlowDiagram plan={plan} tokens={tokens} network={network} compact />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-4 rounded-xl border border-base-300 bg-base-200/40 p-4 text-sm text-pretty">
        <Fact title="Plan details">
          <span>
            Buys {amountIn(params.amountPerTick)} → {tokens.out?.symbol ?? "token"} {formatPeriod(params.period)}
          </span>
          <span className="text-base-content/70">SaucerSwap V2 pool fee: {params.fee / 10_000}%</span>
          <span className="text-base-content/70">Price floor at least {amountOut(params.minAmountOut)} per buy</span>
        </Fact>
        <Fact title="Progress">
          <span>
            {ticksRun(plan.ticks)} of {params.maxTicks === 0n ? "unlimited" : params.maxTicks.toString()} ticks run ·{" "}
            {bought} bought
          </span>
          {average !== null && tokens.in && tokens.out && (
            <>
              <b>
                {amountIn(spent)} → {amountOut(received)}
              </b>
              <span className="text-base-content/70">
                (avg {average.toFixed(2)} {tokens.out.symbol} per {tokens.in.symbol})
              </span>
            </>
          )}
        </Fact>
        <Fact title="Gas deposit">
          <span>
            <b>{formatHbar(plan.deposit + plan.toppedUp)}</b> paid in
          </span>
          {onChain && (
            <span>
              <b>{formatHbar(onChain.gasDeposit)}</b> in the deposit now
            </span>
          )}
          {plan.refunded > 0n && (
            <span>
              <b>{formatHbar(plan.refunded)}</b> refunded
            </span>
          )}
        </Fact>
        <Fact title="Owner">
          <span className="break-all">
            {explorer ? (
              <ExternalLink href={`${explorer}/account/${plan.owner}`}>{shortAddress(plan.owner)}</ExternalLink>
            ) : (
              shortAddress(plan.owner)
            )}
          </span>
          <span className="text-base-content/70">
            Started{" "}
            {explorer ? (
              <ExternalLink href={`${explorer}/transaction/${plan.createdAt}`}>
                {formatTime(plan.createdAt)}
              </ExternalLink>
            ) : (
              formatTime(plan.createdAt)
            )}
          </span>
        </Fact>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)] gap-4 items-start">
        <section className="rounded-2xl border border-base-300 p-4 flex flex-col gap-3">
          <h4 className="m-0 font-bold text-base">Ticks ({plan.ticks.length})</h4>
          <TickTable plan={plan} network={network} tokens={tokens} />
          <p className="m-0 text-xs text-base-content/60">
            Each buy is executed by the network and paid by the contract.
          </p>
        </section>
        <CumulativeChart plan={plan} token={tokens.out} />
      </div>
    </div>
  );
};
