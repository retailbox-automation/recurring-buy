"use client";

import { CumulativeChart } from "./CumulativeChart";
import { FlowDiagram } from "./FlowDiagram";
import { ForDevelopers } from "./ForDevelopers";
import { OUTCOME_BADGE, StatusBadge } from "./PlanDetails";
import { ExternalLink, Linked, Panel, formatAmount, formatClock, formatDay, formatHbar, formatPeriod } from "./common";
import { formatUnits } from "viem";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { referencePlan, useContractId, useReferencePlan, useTickCharges } from "~~/hooks/recurring-buy/useRecurringBuy";
import { boughtTotals } from "~~/utils/recurring-buy/chart";
import { tickTime } from "~~/utils/recurring-buy/plan";

const title = "Live reference plan";

/** The home page's live part: the flow, the reference plan's buys, its chart and the create command. */
export const ReferenceOverview = () => {
  const reference = useReferencePlan();
  const { network, plan, tokens } = reference;
  return (
    <>
      <section className="flex flex-col gap-3">
        <FlowDiagram plan={plan} tokens={tokens} network={network} />
        <p className="m-0 text-sm text-base-content/60 text-center">
          <b>Next tick:</b> as its last step the tick schedules the next one, paid from the plan&apos;s gas deposit.
          Steps 2 to 4 repeat once per period until the plan has run all its ticks, its owner stops it, or the allowance
          or the gas deposit runs out. A tick whose swap would buy below the floor is skipped, and the next one is still
          scheduled.
        </p>
        <p className="m-0 flex items-center justify-center gap-3 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-primary dark:text-base-content">
          <CheckCircleIcon className="size-6 shrink-0 text-primary" aria-hidden />
          <span>
            Every tick is executed by the network and paid by the contract. <b>Nobody presses a button.</b>
          </span>
        </p>
      </section>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-4 items-start">
        <div className="md:col-span-2 2xl:col-span-1">
          <ReferenceCard {...reference} />
        </div>
        <CumulativeChart plan={plan} token={tokens.out} />
        <ForDevelopers />
      </div>
    </>
  );
};

/** The plan from scaffold.config.ts `referencePlan`, read from the mirror node: needs no wallet and no env. */
const ReferenceCard = ({ network, query, plan, tokens }: ReturnType<typeof useReferencePlan>) => {
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
  const oneDay = new Set(times.map(formatDay)).size === 1;

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
              <th>
                Time
                {oneDay && times.length > 0 && <span className="block sm:inline"> ({formatDay(times[0])})</span>}
              </th>
              <th className="hidden sm:table-cell">Swap</th>
              <th className="text-right">Received</th>
              <th className="hidden sm:table-cell text-right">Gas (HBAR)</th>
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
                  <td>
                    {time === null ? "—" : oneDay ? formatClock(time) : `${formatDay(time)}, ${formatClock(time)}`}
                  </td>
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
                  <td className="hidden sm:table-cell text-right">
                    {at && charges[at] !== undefined ? formatAmount(charges[at], 8) : "—"}
                  </td>
                  <td>
                    <div className="flex flex-col sm:flex-row sm:gap-2">
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
    </Panel>
  );
};
