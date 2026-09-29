"use client";

import { useState } from "react";
import Link from "next/link";
import { PlanDetails, StatusBadge } from "./PlanDetails";
import { Panel, formatHbar, formatPeriod } from "./common";
import { useQueryClient } from "@tanstack/react-query";
import { parseEventLogs } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import {
  type RecurringBuyNetwork,
  useHederaFees,
  useOwnerPlans,
  useRecurringBuyNetwork,
  useTokenInfo,
} from "~~/hooks/recurring-buy/useRecurringBuy";
import { useTransactor } from "~~/hooks/scaffold-hbar";
import { recurringBuyAbi } from "~~/utils/recurring-buy/abi";
import type { PlanView } from "~~/utils/recurring-buy/plan";

/**
 * Stops a running plan and refunds its unreserved gas deposit to the owner, or on a plan that already ended only
 * refunds what is left. Hidden when there is nothing to do.
 */
const StopButton = ({ plan, network }: { plan: PlanView; network: RecurringBuyNetwork }) => {
  const { address } = useAccount();
  const { chainId, contract } = network;
  const publicClient = usePublicClient({ chainId });
  const fees = useHederaFees(chainId);
  const writeTx = useTransactor();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refund, setRefund] = useState<bigint | null>(null);
  const { data: onChain, refetch } = useReadContract({
    address: contract,
    abi: recurringBuyAbi,
    functionName: "plans",
    args: [plan.planId],
    chainId,
    query: { enabled: Boolean(contract), refetchInterval: 30_000 },
  });

  if (refund !== null) return <span className="text-sm text-success">Refunded {formatHbar(refund)}</span>;
  if (!onChain || !address || address.toLowerCase() !== plan.owner.toLowerCase()) return null;
  if (!onChain.active && onChain.gasDeposit === 0n) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await writeTx(async () => {
        const request = {
          account: address,
          address: contract!,
          abi: recurringBuyAbi,
          functionName: "stop",
          args: [plan.planId, address],
        } as const;
        const gas = ((await publicClient!.estimateContractGas(request)) * 12n) / 10n;
        const hash = await writeContractAsync({ ...request, gas, chainId, ...(await fees()) });
        const receipt = await publicClient!.waitForTransactionReceipt({ hash });
        // A reverted stop still returns a receipt; useTransactor reports it after this function returns.
        if (receipt.status === "success") {
          const [refunded] = parseEventLogs({ abi: recurringBuyAbi, logs: receipt.logs, eventName: "GasRefunded" });
          setRefund(refunded?.args.amount ?? 0n);
        }
        return hash;
      });
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["recurring-buy", "owner-plans"] });
    } catch {
      // useTransactor has shown the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm btn-outline btn-error" disabled={busy} onClick={stop}>
      {busy ? "Stopping…" : onChain.active ? "Stop and refund deposit" : `Withdraw ${formatHbar(onChain.gasDeposit)}`}
    </button>
  );
};

const PlanSummary = ({ plan, network }: { plan: PlanView; network: RecurringBuyNetwork }) => {
  const { data: tokenOut } = useTokenInfo(network, plan.params.tokenOut);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">Plan #{plan.planId.toString()}</span>
      <StatusBadge status={plan.status} />
      <span className="text-sm text-base-content/60">
        {tokenOut?.symbol ?? "token"} {formatPeriod(plan.params.period)}
      </span>
    </span>
  );
};

/** The connected wallet's plans on the selected network's RecurringBuy, newest first. */
export const MyPlans = () => {
  const network = useRecurringBuyNetwork();
  const { address } = useAccount();
  const { data, isPending, isError, error, refetch } = useOwnerPlans(network, address);

  const newPlan = (
    <Link href="/plans/new" className="btn btn-sm btn-primary">
      New plan
    </Link>
  );

  if (!network.mirror || !network.contract) {
    return (
      <Panel title="My plans">
        <p className="m-0">
          {network.mirror
            ? `There is no RecurringBuy on ${network.networkName} yet.`
            : `${network.networkName} has no public mirror node. Switch your wallet to Hedera Testnet.`}
        </p>
      </Panel>
    );
  }
  if (!address) {
    return (
      <Panel title="My plans">
        <p className="m-0">Connect a wallet to see the plans it started.</p>
      </Panel>
    );
  }
  if (isError) {
    return (
      <Panel title="My plans">
        <p className="m-0 text-error">Could not read plans from the mirror node: {error.message}</p>
        <button className="btn btn-sm btn-outline mt-3" onClick={() => refetch()}>
          Try again
        </button>
      </Panel>
    );
  }
  if (isPending) {
    return (
      <Panel title="My plans">
        <div className="h-24 rounded-xl bg-base-200 animate-pulse" aria-label="Loading plans" />
      </Panel>
    );
  }
  if (data.plans.length === 0) {
    return (
      <Panel title="My plans" action={newPlan}>
        <p className="m-0">This wallet has not started a plan on this contract.</p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold m-0">My plans</h1>
        {newPlan}
      </div>
      {data.truncated && (
        <p className="m-0 text-sm text-warning">
          Only the newest contract events were read; older plans may be missing.
        </p>
      )}
      {data.plans.map(plan => {
        const open = plan.status.kind !== "stopped";
        return (
          <details
            key={plan.planId.toString()}
            open={open}
            className="bg-base-100 rounded-2xl border border-base-300 p-5 sm:p-6"
          >
            <summary className="cursor-pointer list-none">
              <PlanSummary plan={plan} network={network} />
            </summary>
            <div className="mt-4">
              <PlanDetails
                plan={plan}
                network={network}
                showTitle={false}
                actions={<StopButton plan={plan} network={network} />}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
};
