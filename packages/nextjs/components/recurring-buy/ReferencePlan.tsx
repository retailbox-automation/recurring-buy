"use client";

import { OUTCOME_BADGE, StatusBadge } from "./PlanDetails";
import { ExternalLink, Panel, formatAmount, formatHbar, formatPeriod } from "./common";
import { formatUnits } from "viem";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { referencePlan, useContractId, useReferencePlan, useTickCharges } from "~~/hooks/recurring-buy/useRecurringBuy";
import { boughtTotals } from "~~/utils/recurring-buy/chart";
import type { TickRow } from "~~/utils/recurring-buy/plan";

const title = "Live reference plan";

const day = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** When the tick ran, or else when it is due; unix seconds. */
const tickTime = ({ outcome, due }: TickRow) =>
  "timestamp" in outcome && outcome.timestamp ? Number(outcome.timestamp.split(".")[0]) : due;

const Linked = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <ExternalLink href={href}>
    {children}
    <ArrowTopRightOnSquareIcon className="inline size-3.5 ml-0.5 -mt-0.5" aria-hidden />
  </ExternalLink>
);

/** The plan from scaffold.config.ts `referencePlan`, read from the mirror node: needs no wallet and no env. */
export const ReferencePlan = () => {
  const { network, query, plan, tokens } = useReferencePlan();
  const { in: tokenIn, out: tokenOut } = tokens;
  const { data: contractId } = useContractId(network);
  const ran = (plan?.ticks ?? []).flatMap(row =>
    "timestamp" in row.outcome && row.outcome.timestamp ? [row.outcome.timestamp] : [],
  );
  const charges = useTickCharges(network, contractId, ran);
  const { contract, explorer, networkName } = network;

  if (!contract) {
    return (
      <Panel title={title}>
        <p className="m-0 text-base-content/70" data-testid="reference-plan-missing">
          Reference plan not deployed yet. After a deploy (the <code>hardhat:deploy:testnet</code> or{" "}
          <code>foundry:deploy:testnet</code> script) and a first plan, set <code>referencePlan</code> in{" "}
          <code>packages/nextjs/scaffold.config.ts</code> to watch it here.
        </p>
      </Panel>
    );
  }
  if (!network.mirror) {
    return (
      <Panel title={title}>
        <p className="m-0 text-base-content/70">{networkName} has no public mirror node to read the plan from.</p>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <Panel title={title}>
        <p className="m-0 text-error">Could not read the plan from the mirror node: {query.error.message}</p>
        <button className="btn btn-sm btn-outline mt-3" onClick={() => query.refetch()}>
          Try again
        </button>
      </Panel>
    );
  }
  if (!plan || !tokenIn || !tokenOut) {
    const missing = query.data && !query.data.plan;
    return (
      <Panel title={title}>
        {missing ? (
          <p className="m-0 text-base-content/70">
            {query.data?.truncated
              ? `Plan #${referencePlan.planId} was created before the newest events this page reads from the mirror node.`
              : `The mirror node has no plan #${referencePlan.planId} for this contract yet.`}
          </p>
        ) : (
          <div className="h-56 rounded-xl bg-base-200 animate-pulse" aria-label="Loading the reference plan" />
        )}
      </Panel>
    );
  }

  const { params } = plan;
  const amountIn = (value: bigint) => `${formatAmount(value, tokenIn.decimals)} ${tokenIn.symbol}`;
  const amountOut = (value: bigint) => `${formatAmount(value, tokenOut.decimals)} ${tokenOut.symbol}`;
  const { spent, received } = boughtTotals(plan.ticks);
  const average = Number(formatUnits(received, tokenOut.decimals)) / Number(formatUnits(spent, tokenIn.decimals));
  const gas = ran.every(at => charges[at] !== undefined) ? ran.reduce((sum, at) => sum + charges[at], 0n) : null;
  const times = plan.ticks.flatMap(row => tickTime(row) ?? []);
  const oneDay = new Set(times.map(day)).size === 1;

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-3">
          {title}
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Plan #{plan.planId.toString()} <StatusBadge status={plan.status} />
          </span>
        </span>
      }
    >
      <p className="m-0 -mt-3 mb-3 text-sm text-base-content/60">
        Read from contract{" "}
        {explorer ? (
          <ExternalLink href={`${explorer}/contract/${contract}`}>{contractId ?? contract}</ExternalLink>
        ) : (
          contractId
        )}{" "}
        on {networkName}
      </p>
      <ul className="m-0 p-0 list-none text-sm leading-6">
        <li>
          <b>
            {amountIn(params.amountPerTick)} → {tokenOut.symbol}
          </b>{" "}
          {formatPeriod(params.period)}, {params.maxTicks === 0n ? "until stopped" : `${params.maxTicks} buys`}
        </li>
        <li>Price floor: at least {amountOut(params.minAmountOut)} per buy</li>
        {spent > 0n && (
          <li>
            Result: {amountIn(spent)} → {amountOut(received)} (avg {average.toFixed(2)} {tokenOut.symbol} per{" "}
            {tokenIn.symbol})
          </li>
        )}
        {gas !== null && ran.length > 0 && (
          <li>
            Gas: {formatHbar(gas)} for {ran.length} ticks, paid by the contract
          </li>
        )}
        <li>
          Gas deposit: {formatHbar(plan.deposit + plan.toppedUp)} paid in
          {plan.refunded > 0n && <>, {formatHbar(plan.refunded)} refunded</>}
        </li>
      </ul>

      <div className="overflow-x-auto mt-3">
        <table className="table table-xs">
          <thead>
            <tr className="bg-base-200">
              <th>#</th>
              <th>Time{oneDay && times.length > 0 && ` (${day(times[0])})`}</th>
              <th className="hidden sm:table-cell">Swap</th>
              <th className="text-right">{tokenOut.symbol} received</th>
              <th className="text-right">Gas (HBAR)</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {plan.ticks.map(row => {
              const time = tickTime(row);
              const at = "timestamp" in row.outcome ? row.outcome.timestamp : "";
              const [style, label] = OUTCOME_BADGE[row.outcome.kind];
              return (
                <tr key={row.tick} data-testid="tick-row" className="tabular-nums whitespace-nowrap">
                  <td>{row.tick}</td>
                  <td>{time === null ? "—" : oneDay ? clock(time) : `${day(time)}, ${clock(time)}`}</td>
                  <td className="hidden sm:table-cell">
                    {row.outcome.kind === "bought" ? (
                      `${amountIn(row.outcome.amountIn)} → ${tokenOut.symbol}`
                    ) : (
                      <span className={`badge badge-sm ${style}`}>{label}</span>
                    )}
                  </td>
                  <td className="text-right">
                    {row.outcome.kind === "bought" ? formatAmount(row.outcome.amountOut, tokenOut.decimals) : "—"}
                  </td>
                  <td className="text-right">{at && charges[at] !== undefined ? formatAmount(charges[at], 8) : "—"}</td>
                  <td className="space-x-2">
                    {explorer && at && <Linked href={`${explorer}/transaction/${at}`}>tx</Linked>}
                    {explorer && row.scheduleId && (
                      <Linked href={`${explorer}/schedule/${row.scheduleId}`}>schedule</Linked>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};
