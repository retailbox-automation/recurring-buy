"use client";

import { useState } from "react";
import Link from "next/link";
import { PlanDetails, StatusBadge } from "./PlanDetails";
import { formatAmount, formatHbar, formatPeriod } from "./common";
import { useQueryClient } from "@tanstack/react-query";
import { parseEventLogs } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import {
  type RecurringBuyNetwork,
  useHederaFees,
  useOwnerPlans,
  useRecurringBuyNetwork,
  useTokenInfo,
} from "~~/hooks/recurring-buy/useRecurringBuy";
import { useTransactor } from "~~/hooks/scaffold-hbar";
import { recurringBuyAbi } from "~~/utils/recurring-buy/abi";
import { boughtTotals } from "~~/utils/recurring-buy/chart";
import { stopGasLimit } from "~~/utils/recurring-buy/costs";
import { type PlanView, ticksRun } from "~~/utils/recurring-buy/plan";

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
        const gas = stopGasLimit(await publicClient!.estimateContractGas(request));
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
    <button className="btn btn-sm btn-error btn-soft" disabled={busy} onClick={stop}>
      {busy ? "Stopping…" : onChain.active ? "Stop and refund deposit" : `Withdraw ${formatHbar(onChain.gasDeposit)}`}
    </button>
  );
};

/** The line a plan's card shows while it is closed: number, status, what it buys, and for an ended plan its outcome. */
const PlanSummary = ({ plan, network }: { plan: PlanView; network: RecurringBuyNetwork }) => {
  const { data: tokenIn } = useTokenInfo(network, plan.params.tokenIn);
  const { data: tokenOut } = useTokenInfo(network, plan.params.tokenOut);
  const ended = plan.status.kind === "stopped";
  const { spent, received } = boughtTotals(plan.ticks);
  const bought = plan.ticks.filter(row => row.outcome.kind === "bought").length;
  const ran = ticksRun(plan.ticks);
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className={`font-bold ${ended ? "text-lg" : "text-2xl"}`}>Plan #{plan.planId.toString()}</span>
      <StatusBadge status={plan.status} />
      <span className="text-base-content/60">
        {tokenOut?.symbol ?? "token"} {formatPeriod(plan.params.period)}
      </span>
      {ended && tokenIn && tokenOut && (
        <span className="text-sm text-base-content/60">
          {ran} {ran === 1 ? "tick" : "ticks"} run · {bought} bought
          {spent > 0n &&
            ` · ${formatAmount(spent, tokenIn.decimals)} ${tokenIn.symbol} → ${formatAmount(received, tokenOut.decimals)} ${tokenOut.symbol}`}
          {plan.refunded > 0n && ` · ${formatHbar(plan.refunded)} refunded`}
        </span>
      )}
      <ChevronDownIcon className="size-5 ml-auto text-base-content/50 transition-transform group-open:rotate-180" />
    </span>
  );
};

const PlanCard = ({ plan, network }: { plan: PlanView; network: RecurringBuyNetwork }) => (
  <details
    open={plan.status.kind !== "stopped"}
    className="group bg-base-100 rounded-2xl border border-base-300 px-5 py-4 sm:px-6"
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

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-base-100 rounded-2xl border border-base-300 p-6">{children}</div>
);

const PlansContent = () => {
  const network = useRecurringBuyNetwork();
  const { address } = useAccount();
  const { data, isPending, isError, error, refetch } = useOwnerPlans(network, address);

  if (!network.mirror || !network.contract) {
    return (
      <Notice>
        <p className="m-0">
          {network.mirror
            ? `There is no RecurringBuy on ${network.networkName} yet.`
            : `${network.networkName} has no public mirror node. Switch your wallet to Hedera Testnet.`}
        </p>
      </Notice>
    );
  }
  if (!address) {
    return (
      <Notice>
        <p className="m-0">Connect a wallet to see the plans it started.</p>
      </Notice>
    );
  }
  if (isError) {
    return (
      <Notice>
        <p className="m-0 text-error">Could not read plans from the mirror node: {error.message}</p>
        <button className="btn btn-sm btn-outline mt-3" onClick={() => refetch()}>
          Try again
        </button>
      </Notice>
    );
  }
  if (isPending) return <div className="h-40 rounded-2xl bg-base-200 animate-pulse" aria-label="Loading plans" />;
  if (data.plans.length === 0) {
    return (
      <Notice>
        <p className="m-0">This wallet has not started a plan on this contract.</p>
      </Notice>
    );
  }

  const current = data.plans.filter(plan => plan.status.kind !== "stopped");
  const older = data.plans.filter(plan => plan.status.kind === "stopped");
  return (
    <>
      {data.truncated && (
        <p className="m-0 text-sm text-warning">
          Only the newest contract events were read; older plans may be missing.
        </p>
      )}
      {current.map(plan => (
        <PlanCard key={plan.planId.toString()} plan={plan} network={network} />
      ))}
      {older.length > 0 && (
        <>
          <h2 className="m-0 mt-2 text-xl font-bold">{current.length ? "Older plans" : "Your plans"}</h2>
          {older.map(plan => (
            <PlanCard key={plan.planId.toString()} plan={plan} network={network} />
          ))}
        </>
      )}
    </>
  );
};

/** The connected wallet's plans on the selected network's RecurringBuy: running ones open, ended ones closed. */
export const MyPlans = () => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="m-0 text-4xl md:text-5xl font-bold tracking-tight">My plans</h1>
        <p className="m-0 mt-2 text-lg text-base-content/60">Your recurring buys, read from the network.</p>
      </div>
      <Link href="/plans/new" className="btn btn-primary btn-lg px-10">
        New plan
      </Link>
    </div>
    <PlansContent />
  </div>
);
