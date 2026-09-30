"use client";

import { PlanDetails } from "./PlanDetails";
import { ExternalLink, Panel } from "./common";
import { referencePlan, useContractId, usePlan, useReferenceNetwork } from "~~/hooks/recurring-buy/useRecurringBuy";

/** The plan from scaffold.config.ts `referencePlan`, read from the mirror node: needs no wallet and no env. */
export const ReferencePlan = () => {
  const network = useReferenceNetwork();
  const { data, isPending, isError, error, refetch } = usePlan(network, referencePlan.planId);
  const { data: contractId } = useContractId(network);
  const { contract, explorer, networkName } = network;

  const title = "Reference plan";
  const contractLink =
    contract && explorer ? (
      <span className="text-sm text-base-content/60">
        RecurringBuy{" "}
        <ExternalLink href={`${explorer}/contract/${contract}`}>
          {contractId ?? `${contract.slice(0, 6)}…${contract.slice(-4)}`}
        </ExternalLink>{" "}
        on {networkName}
      </span>
    ) : null;

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
  if (isError) {
    return (
      <Panel title={title} action={contractLink}>
        <p className="m-0 text-error">Could not read the plan from the mirror node: {error.message}</p>
        <button className="btn btn-sm btn-outline mt-3" onClick={() => refetch()}>
          Try again
        </button>
      </Panel>
    );
  }
  if (isPending) {
    return (
      <Panel title={title} action={contractLink}>
        <div className="h-40 rounded-xl bg-base-200 animate-pulse" aria-label="Loading the reference plan" />
      </Panel>
    );
  }
  if (!data.plan) {
    return (
      <Panel title={title} action={contractLink}>
        <p className="m-0 text-base-content/70">
          {data.truncated
            ? `Plan #${referencePlan.planId} was created before the newest events this page reads from the mirror node.`
            : `The mirror node has no plan #${referencePlan.planId} for this contract yet.`}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title={title} action={contractLink}>
      <PlanDetails plan={data.plan} network={network} />
    </Panel>
  );
};
