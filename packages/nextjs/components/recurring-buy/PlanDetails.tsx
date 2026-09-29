"use client";

import { ExternalLink, formatHbar, formatPeriod, formatRemaining, formatTime, formatToken, useNow } from "./common";
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
import {
  BELOW_FLOOR_REASON,
  type ChainStatus,
  type PlanView,
  type TickRow,
  ticksRun,
} from "~~/utils/recurring-buy/plan";

type Tokens = { in: TokenInfo | null | undefined; out: TokenInfo | null | undefined };

const STATUS_BADGE: Record<ChainStatus["kind"], [string, string]> = {
  running: ["badge-success", "Running"],
  due: ["badge-info", "Buying now"],
  stopped: ["badge-neutral", "Stopped"],
  broken: ["badge-error", "Chain broken"],
  indexing: ["badge-ghost", "Syncing"],
};

export const StatusBadge = ({ status }: { status: ChainStatus }) => {
  const [style, label] =
    status.kind === "stopped" && status.reason === "Completed"
      ? ["badge-neutral", "Completed"]
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

const OUTCOME_BADGE: Record<TickRow["outcome"]["kind"], [string, string]> = {
  bought: ["badge-success", "Bought"],
  skipped: ["badge-warning", "Skipped"],
  "pull-failed": ["badge-error", "Pull failed"],
  reverted: ["badge-error", "Reverted"],
  waiting: ["badge-info", "Scheduled"],
  due: ["badge-info", "Due"],
  missed: ["badge-error", "Missed"],
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

const TickTable = ({ plan, network, tokens }: { plan: PlanView; network: RecurringBuyNetwork; tokens: Tokens }) => {
  const now = useNow();
  const { data: contractId } = useContractId(network);
  const timestamps = plan.ticks.flatMap(row => executedAt(row) ?? []);
  const charges = useTickCharges(network, contractId, timestamps);
  const { explorer } = network;

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="table table-sm">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th className="hidden sm:table-cell">Due</th>
            <th>Result</th>
            <th className="hidden md:table-cell text-right">Gas paid</th>
            <th className="text-right">Hashscan</th>
          </tr>
        </thead>
        <tbody>
          {[...plan.ticks].reverse().map(row => {
            const [style, label] = OUTCOME_BADGE[row.outcome.kind];
            const at = executedAt(row);
            return (
              <tr key={row.tick} data-testid="tick-row">
                <td className="tabular-nums">{row.tick}</td>
                <td className="hidden sm:table-cell whitespace-nowrap text-base-content/70">
                  {row.due === null ? "—" : formatTime(row.due)}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`badge badge-sm ${style}`}>{label}</span>
                    <span className="text-sm">{outcomeText(row, plan, tokens, now)}</span>
                  </div>
                </td>
                <td className="hidden md:table-cell text-right tabular-nums whitespace-nowrap">
                  {at && charges[at] !== undefined ? formatHbar(charges[at]) : "—"}
                </td>
                <td className="text-right whitespace-nowrap">
                  {explorer && at && <ExternalLink href={`${explorer}/transaction/${at}`}>tx</ExternalLink>}
                  {explorer && at && row.scheduleId && " · "}
                  {explorer && row.scheduleId && (
                    <ExternalLink href={`${explorer}/schedule/${row.scheduleId}`}>schedule</ExternalLink>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

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

  const bought = plan.ticks.flatMap(row => (row.outcome.kind === "bought" ? [row.outcome] : []));
  const spent = bought.reduce((sum, tick) => sum + tick.amountIn, 0n);
  const received = bought.reduce((sum, tick) => sum + tick.amountOut, 0n);
  const average =
    tokens.in && tokens.out && spent > 0n
      ? Number(formatUnits(received, tokens.out.decimals)) / Number(formatUnits(spent, tokens.in.decimals))
      : null;
  const { explorer } = network;

  return (
    <div className="flex flex-col gap-4">
      {(showTitle || actions) && (
        <div className="flex flex-wrap items-center gap-3">
          {showTitle && (
            <>
              <h3 className="font-bold text-base m-0">Plan #{plan.planId.toString()}</h3>
              <StatusBadge status={status} />
            </>
          )}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}

      <div className="rounded-xl bg-base-200 px-4 py-3 text-sm">
        <ChainLine status={status} now={now} />
        {status.kind === "broken" && onChain?.active && (
          <p className="m-0 mt-1 text-base-content/70">
            The contract still reports this plan as active: a tick that reverts as a whole also undoes its own
            bookkeeping. This status comes from the last schedule&apos;s execution instead.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 sm:gap-y-2 m-0 text-sm [&>dd]:mb-2 sm:[&>dd]:mb-0">
        <dt className="text-base-content/60">Buys</dt>
        <dd className="m-0">
          {formatToken(params.amountPerTick, params.tokenIn, tokens.in)} → {tokens.out?.symbol ?? "token"}{" "}
          {formatPeriod(params.period)}, pool fee {params.fee / 10_000}%
        </dd>
        <dt className="text-base-content/60">Price floor</dt>
        <dd className="m-0">at least {formatToken(params.minAmountOut, params.tokenOut, tokens.out)} per buy</dd>
        <dt className="text-base-content/60">Progress</dt>
        <dd className="m-0">
          {ticksRun(plan.ticks)} of {params.maxTicks === 0n ? "unlimited" : params.maxTicks.toString()} ticks run ·{" "}
          {bought.length} bought
          {average !== null && tokens.in && tokens.out && (
            <span className="text-base-content/60">
              {" "}
              · {formatToken(spent, params.tokenIn, tokens.in)} → {formatToken(received, params.tokenOut, tokens.out)}{" "}
              (avg {average.toPrecision(6)} {tokens.out.symbol} per {tokens.in.symbol})
            </span>
          )}
        </dd>
        <dt className="text-base-content/60">Gas deposit</dt>
        <dd className="m-0">
          {formatHbar(plan.deposit + plan.toppedUp)} paid in
          {onChain && <> · {formatHbar(onChain.gasDeposit)} not yet reserved</>}
          {plan.refunded > 0n && <> · {formatHbar(plan.refunded)} refunded</>}
        </dd>
        <dt className="text-base-content/60">Owner</dt>
        <dd className="m-0 break-all">
          {explorer ? <ExternalLink href={`${explorer}/account/${plan.owner}`}>{plan.owner}</ExternalLink> : plan.owner}
        </dd>
        <dt className="text-base-content/60">Started</dt>
        <dd className="m-0">
          {explorer ? (
            <ExternalLink href={`${explorer}/transaction/${plan.createdAt}`}>{formatTime(plan.createdAt)}</ExternalLink>
          ) : (
            formatTime(plan.createdAt)
          )}
        </dd>
      </dl>

      <TickTable plan={plan} network={network} tokens={tokens} />
    </div>
  );
};
