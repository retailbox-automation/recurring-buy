"use client";

import { useState } from "react";
import Link from "next/link";
import { PlanDetails } from "./PlanDetails";
import { ExternalLink, Panel, formatHbar, formatPeriod, formatToken } from "./common";
import { associateCalldata, hashioGasPrice, hederaIdToLongZeroAddress, minOut } from "@sh/saucerswap";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatUnits, getAddress, isAddress, parseEventLogs, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSendTransaction,
  useWriteContract,
} from "wagmi";
import {
  type RecurringBuyNetwork,
  defaultRoute,
  useHederaFees,
  useMirrorAccount,
  useOwnerPlans,
  usePlan,
  useQuote,
  useRecurringBuyNetwork,
  useTokenInfo,
} from "~~/hooks/recurring-buy/useRecurringBuy";
import { useTransactor } from "~~/hooks/scaffold-hbar";
import { recurringBuyAbi } from "~~/utils/recurring-buy/abi";
import { type PlanParams, ticksRun } from "~~/utils/recurring-buy/plan";

/**
 * Gas limit of every tick. A tick that pulled, swapped and scheduled the next one used 1,622,904 gas in the prototype
 * on testnet (docs/testnet-findings.md, B5); the contract keeps RESCHEDULE_GAS of it back for the next schedule.
 * TODO(deploy): set both constants, and the start costs quoted under "Start" in step 2, from this template's own contract.
 */
const TICK_GAS_LIMIT = 1_900_000n;
/** Gas one tick used on testnet, for the estimate of what a tick costs. */
const TICK_GAS_USED = 1_622_904n;
/** JSON-RPC counts HBAR in weibar (18 decimals), the EVM and the contract in tinybar (8). */
const WEIBAR_PER_TINYBAR = 10_000_000_000n;

const PERIOD_UNITS = { minutes: 60, hours: 3600, days: 86_400, weeks: 604_800 } as const;
type PeriodUnit = keyof typeof PERIOD_UNITS;

type Form = {
  tokenIn: string;
  tokenOut: string;
  fee: string;
  amount: string;
  every: string;
  unit: PeriodUnit;
  ticks: string;
  floorPercent: string;
};

const toHederaId = (address: string) => `0.0.${BigInt(address)}`;

/** "0.0.N" or an EVM address as an EVM address; null when it is neither. */
function toTokenAddress(input: string): string | null {
  const value = input.trim();
  if (/^0\.0\.\d+$/.test(value)) return hederaIdToLongZeroAddress(value);
  return isAddress(value) ? getAddress(value) : null;
}

function parseAmount(value: string, decimals: number | undefined): bigint {
  if (decimals === undefined) return 0n;
  try {
    return parseUnits(value.trim(), decimals);
  } catch {
    return 0n;
  }
}

function initialForm(chainId: number): Form {
  const route = defaultRoute(chainId);
  return {
    tokenIn: route ? toHederaId(route.tokenIn) : "",
    tokenOut: route ? toHederaId(route.tokenOut) : "",
    fee: String(route?.fee ?? 3000),
    amount: "0.05",
    every: "1",
    unit: "days",
    ticks: "4",
    floorPercent: "5",
  };
}

const Field = ({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) => (
  <fieldset className="fieldset p-0">
    <legend className="fieldset-legend">{label}</legend>
    {children}
    {hint && <p className="label m-0 whitespace-normal">{hint}</p>}
  </fieldset>
);

type StepState = "done" | "todo" | "blocked";

const Step = ({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}) => (
  <li className="flex gap-3">
    <span
      className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
        state === "done" ? "bg-success text-success-content" : "bg-base-200 text-base-content/70"
      }`}
    >
      {state === "done" ? "✓" : n}
    </span>
    <div className="flex flex-col gap-2 min-w-0 grow">
      <span className={`font-semibold ${state === "blocked" ? "text-base-content/50" : ""}`}>{title}</span>
      {children}
    </div>
  </li>
);

const Unavailable = ({ network }: { network: RecurringBuyNetwork }) => (
  <Panel title={`Not available on ${network.networkName}`}>
    {!network.mirror ? (
      <p className="m-0">
        Recurring Buy runs on Hedera testnet or mainnet: its ticks need the Hedera Schedule Service, and this page reads
        them from a mirror node. Switch your wallet to Hedera Testnet.
      </p>
    ) : (
      <p className="m-0">
        There is no RecurringBuy on {network.networkName} yet. Deploy one with <code>yarn hardhat:deploy:testnet</code>,
        or set <code>referencePlan.contract</code> in <code>packages/nextjs/scaffold.config.ts</code> to a deployed one.
      </p>
    )}
  </Panel>
);

/** Form, cost disclosure and the three transactions that start a plan: association, allowance, start. */
export const NewPlanForm = () => {
  const network = useRecurringBuyNetwork();
  if (!network.mirror || !network.contract) return <Unavailable network={network} />;
  return <PlanBuilder key={network.chainId} network={network} contract={network.contract} />;
};

const PlanBuilder = ({ network, contract }: { network: RecurringBuyNetwork; contract: `0x${string}` }) => {
  const { chainId, explorer } = network;
  const { address, chainId: walletChainId } = useAccount();
  const onNetwork = Boolean(address) && walletChainId === chainId;
  const publicClient = usePublicClient({ chainId });
  const fees = useHederaFees(chainId);
  const writeTx = useTransactor();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const [form, setForm] = useState<Form>(() => initialForm(chainId));
  const set = (field: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(current => ({ ...current, [field]: e.target.value }));
  const [busy, setBusy] = useState<"associate" | "approve" | "start" | null>(null);
  const [createdPlanId, setCreatedPlanId] = useState<bigint | null>(null);

  // ---- what the form describes -------------------------------------------------------------------------------
  const tokenIn = toTokenAddress(form.tokenIn);
  const tokenOut = toTokenAddress(form.tokenOut);
  const fee = Number(form.fee);
  const { data: inInfo, isFetched: inFetched } = useTokenInfo(network, tokenIn ?? undefined);
  const { data: outInfo, isFetched: outFetched } = useTokenInfo(network, tokenOut ?? undefined);
  const amountPerTick = parseAmount(form.amount, inInfo?.decimals);
  const ticks = /^\d+$/.test(form.ticks.trim()) ? BigInt(form.ticks.trim()) : 0n;
  const every = /^\d+$/.test(form.every.trim()) ? BigInt(form.every.trim()) : 0n;
  const period = every * BigInt(PERIOD_UNITS[form.unit]);
  const floorPercent = Number(form.floorPercent);
  const floorBps = Number.isFinite(floorPercent) ? Math.round(floorPercent * 100) : -1;
  const floorValid = floorBps >= 0 && floorBps < 10_000;
  const route = tokenIn && tokenOut && tokenIn !== tokenOut ? { tokenIn, fee, tokenOut } : null;
  const quote = useQuote(chainId, route, amountPerTick);
  const minAmountOut =
    quote.data && floorValid && quote.data.amountOut > 0n ? minOut(quote.data.amountOut, floorBps) : 0n;
  const total = amountPerTick * ticks;

  // ---- contract and wallet state -----------------------------------------------------------------------------
  const { data: contractState } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: contract, abi: recurringBuyAbi, functionName: "reserveGasPrice", chainId },
      { address: contract, abi: recurringBuyAbi, functionName: "RESCHEDULE_GAS", chainId },
      { address: contract, abi: recurringBuyAbi, functionName: "tokenReady", args: [tokenIn ?? contract], chainId },
    ],
    query: { enabled: Boolean(tokenIn) },
  });
  const [reserveGasPrice, rescheduleGas, tokenReady] = contractState ?? [];
  const tickGasLimit =
    rescheduleGas !== undefined && rescheduleGas + 300_000n > TICK_GAS_LIMIT
      ? rescheduleGas + 300_000n
      : TICK_GAS_LIMIT;
  const reservePerTick = reserveGasPrice !== undefined ? tickGasLimit * reserveGasPrice : undefined;
  const deposit = reservePerTick !== undefined ? reservePerTick * ticks : undefined;

  const { data: gasPriceTinybar } = useQuery({
    queryKey: ["recurring-buy", "gas-price", chainId],
    queryFn: async () => (await hashioGasPrice(publicClient!)) / WEIBAR_PER_TINYBAR,
    enabled: Boolean(publicClient),
    refetchInterval: 60_000,
  });

  const account = useMirrorAccount(
    network,
    address,
    [tokenIn, tokenOut].filter(t => t !== null),
  );
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn ?? undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? contract, contract],
    chainId,
    query: { enabled: Boolean(tokenIn && address) },
  });

  // Plans of one owner on the same token share one allowance, so a new plan adds its total to what the owner's
  // other running plans can still take.
  const ownerPlans = useOwnerPlans(network, address);
  const sharing = (ownerPlans.data?.plans ?? []).filter(
    plan =>
      tokenIn &&
      plan.params.tokenIn.toLowerCase() === tokenIn.toLowerCase() &&
      (plan.status.kind === "running" || plan.status.kind === "due" || plan.status.kind === "indexing"),
  );
  const unboundedShare = sharing.some(plan => plan.params.maxTicks === 0n);
  const othersNeed = sharing.reduce((sum, plan) => {
    const run = BigInt(ticksRun(plan.ticks));
    return plan.params.maxTicks > run ? sum + (plan.params.maxTicks - run) * plan.params.amountPerTick : sum;
  }, 0n);
  const neededAllowance = total + othersNeed;
  // Until the owner's other plans are read, what they still need from the allowance is unknown.
  const sharingKnown = ownerPlans.isSuccess || !address;

  // Undefined while the account loads; 0 when the account does not hold the token at all.
  const inBalance = tokenIn && account.data ? (account.data.tokens[tokenIn.toLowerCase()] ?? 0n) : undefined;
  const outAssociated = tokenOut ? account.data?.tokens[tokenOut.toLowerCase()] !== undefined : false;
  const autoAssociates = account.data?.maxAutoAssociations === -1;

  // ---- validation --------------------------------------------------------------------------------------------
  const problems: string[] = [];
  if (!tokenIn || !tokenOut) problems.push("Enter both tokens as 0.0.N or an EVM address.");
  else if (tokenIn === tokenOut) problems.push("Spend and buy tokens must differ.");
  else if ((inFetched && !inInfo) || (outFetched && !outInfo)) problems.push("The mirror node has no such token.");
  if (amountPerTick <= 0n) problems.push("Enter an amount per buy above zero.");
  if (period <= 0n) problems.push("Enter a period of at least one unit.");
  if (ticks <= 0n) problems.push("Enter how many times to buy (1 or more).");
  if (!floorValid) problems.push("The price floor must be 0-99.99% below the quote.");
  if (quote.isError) problems.push("SaucerSwap has no pool with liquidity for this pair, fee and amount.");

  const ready = problems.length === 0 && minAmountOut > 0n && deposit !== undefined;
  const associationDone = outAssociated || autoAssociates;
  const allowanceDone = allowance !== undefined && ready && sharingKnown && allowance >= neededAllowance;
  const hasSlice = inBalance !== undefined && inBalance >= amountPerTick;

  const params: PlanParams = {
    tokenIn: tokenIn ?? contract,
    fee,
    tokenOut: tokenOut ?? contract,
    amountPerTick,
    minAmountOut,
    period,
    maxTicks: ticks,
    tickGasLimit,
  };

  // ---- transactions ------------------------------------------------------------------------------------------
  const run = async (step: NonNullable<typeof busy>, send: () => Promise<`0x${string}`>, after?: () => unknown) => {
    setBusy(step);
    try {
      await writeTx(send);
      await after?.();
    } catch {
      // useTransactor has shown the error.
    } finally {
      setBusy(null);
    }
  };

  const associate = () =>
    run(
      "associate",
      async () => {
        const request = { account: address!, to: tokenOut!, data: associateCalldata() };
        const gas = ((await publicClient!.estimateGas(request)) * 12n) / 10n;
        return sendTransactionAsync({ to: tokenOut!, data: request.data, gas, chainId, ...(await fees()) });
      },
      () => account.refetch(),
    );

  const approve = () =>
    run(
      "approve",
      async () => {
        const request = {
          account: address!,
          address: tokenIn!,
          abi: erc20Abi,
          functionName: "approve",
          args: [contract, neededAllowance],
        } as const;
        const gas = ((await publicClient!.estimateContractGas(request)) * 12n) / 10n;
        return writeContractAsync({ ...request, gas, chainId, ...(await fees()) });
      },
      () => refetchAllowance(),
    );

  const start = () =>
    run("start", async () => {
      const request = {
        account: address!,
        address: contract,
        abi: recurringBuyAbi,
        functionName: "start",
        args: [params],
        value: deposit! * WEIBAR_PER_TINYBAR,
      } as const;
      const gas = ((await publicClient!.estimateContractGas(request)) * 12n) / 10n;
      const hash = await writeContractAsync({ ...request, gas, chainId, ...(await fees()) });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        const [created] = parseEventLogs({ abi: recurringBuyAbi, logs: receipt.logs, eventName: "PlanCreated" });
        if (created) setCreatedPlanId(created.args.planId);
      }
      return hash;
    });

  if (createdPlanId !== null) return <Created network={network} planId={createdPlanId} />;

  const inSymbol = inInfo?.symbol ?? "token";
  const outSymbol = outInfo?.symbol ?? "token";

  return (
    <div className="flex flex-col gap-6">
      <Panel title="1. Describe the plan">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <Field
            label="Spend"
            hint={inInfo ? `${inInfo.symbol}, ${inInfo.decimals} decimals` : "HTS token id or address"}
          >
            <input className="input w-full" value={form.tokenIn} onChange={set("tokenIn")} spellCheck={false} />
          </Field>
          <Field
            label="Buy"
            hint={outInfo ? `${outInfo.symbol}, ${outInfo.decimals} decimals` : "HTS token id or address"}
          >
            <input className="input w-full" value={form.tokenOut} onChange={set("tokenOut")} spellCheck={false} />
          </Field>
          <Field label={`Amount per buy (${inSymbol})`}>
            <input className="input w-full" inputMode="decimal" value={form.amount} onChange={set("amount")} />
          </Field>
          <Field label="SaucerSwap V2 pool fee">
            <select className="select w-full" value={form.fee} onChange={set("fee")}>
              <option value="500">0.05%</option>
              <option value="1500">0.15%</option>
              <option value="3000">0.3%</option>
              <option value="10000">1%</option>
            </select>
          </Field>
          <Field label="Every">
            <div className="flex gap-2">
              <input className="input w-24" inputMode="numeric" value={form.every} onChange={set("every")} />
              <select className="select grow" value={form.unit} onChange={set("unit")}>
                {Object.keys(PERIOD_UNITS).map(unit => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Number of buys">
            <input className="input w-full" inputMode="numeric" value={form.ticks} onChange={set("ticks")} />
          </Field>
          <Field
            label="Price floor, % below today's quote"
            hint="A tick that would get less is skipped: nothing is taken, and the next tick is still scheduled."
          >
            <input
              className="input w-full"
              inputMode="decimal"
              value={form.floorPercent}
              onChange={set("floorPercent")}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="2. Check what you sign">
        {problems.length > 0 ? (
          <ul className="m-0 pl-5 list-disc text-warning-content bg-warning/20 rounded-xl py-3 pr-3 text-sm">
            {problems.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <p className="m-0 text-base">
              Buy {outSymbol} with {formatToken(amountPerTick, tokenIn!, inInfo)} {formatPeriod(period)},{" "}
              {ticks.toString()} {ticks === 1n ? "time" : "times"}.
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 sm:gap-y-2 m-0 [&>dd]:mb-2 sm:[&>dd]:mb-0">
              <dt className="text-base-content/60">Quote now</dt>
              <dd className="m-0">
                {quote.data ? formatToken(quote.data.amountOut, tokenOut!, outInfo) : "…"} per buy (SaucerSwap QuoterV2)
              </dd>
              <dt className="text-base-content/60">Price floor</dt>
              <dd className="m-0">
                {minAmountOut > 0n ? `at least ${formatToken(minAmountOut, tokenOut!, outInfo)} per buy` : "…"}
              </dd>
              <dt className="text-base-content/60">Allowance</dt>
              <dd className="m-0">
                up to {formatToken(total, tokenIn!, inInfo)} in total, taken one buy at a time. Revoke any time by
                approving 0.
              </dd>
              <dt className="text-base-content/60">Gas per tick</dt>
              <dd className="m-0">
                {reservePerTick !== undefined ? (
                  <>
                    <b>{formatHbar(reservePerTick)}</b> reserved from the deposit ({tickGasLimit.toLocaleString()} gas ×{" "}
                    {reserveGasPrice?.toString()} tinybar, the contract&apos;s reserve price).
                    {gasPriceTinybar !== undefined && (
                      <>
                        {" "}
                        A tick costs about {formatHbar(TICK_GAS_USED * gasPriceTinybar)} at today&apos;s gas price. The
                        contract charges the plan what the tick used and puts the rest of the reservation back into the
                        deposit.
                      </>
                    )}
                  </>
                ) : (
                  "…"
                )}
              </dd>
              <dt className="text-base-content/60">Gas deposit</dt>
              <dd className="m-0">
                {deposit !== undefined ? (
                  <>
                    <b>{formatHbar(deposit)}</b>, one reservation for each of the {ticks.toString()} ticks, paid with
                    the start transaction. What the ticks do not use stays in the deposit: withdraw it when the plan
                    ends, or stop early and get it back with the pending tick&apos;s reservation, if Hedera deletes that
                    schedule.
                  </>
                ) : (
                  "…"
                )}
              </dd>
              <dt className="text-base-content/60">Start</dt>
              <dd className="m-0">
                The start transaction costs its own gas (about 1.8 HBAR on testnet)
                {tokenReady === false &&
                  ", plus about 1.5 HBAR once: the contract associates itself with the spend token"}
                .
              </dd>
            </dl>
          </div>
        )}
      </Panel>

      <Panel title="3. Sign">
        {!address ? (
          <p className="m-0">Connect a wallet on {network.networkName} with the button at the top right.</p>
        ) : !onNetwork ? (
          <p className="m-0">Switch your wallet to {network.networkName}.</p>
        ) : account.data === null ? (
          <p className="m-0">
            This address has no Hedera account yet. Send it some HBAR (for example from the faucet) to create one.
          </p>
        ) : (
          <ol className="flex flex-col gap-5 m-0 p-0 list-none">
            <Step n={1} title={`Receive ${outSymbol}`} state={associationDone ? "done" : "todo"}>
              {associationDone ? (
                <p className="m-0 text-sm text-base-content/70">
                  {outAssociated
                    ? `Your account is associated with ${outSymbol}.`
                    : "Your account associates new tokens automatically when they arrive."}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn btn-sm btn-primary" disabled={busy !== null || !tokenOut} onClick={associate}>
                    {busy === "associate" ? "Associating…" : `Associate ${outSymbol}`}
                  </button>
                  <span className="text-sm text-base-content/70">
                    HTS tokens need an association before you can receive them (HIP-719, about 0.8 HBAR).
                  </span>
                </div>
              )}
            </Step>
            <Step
              n={2}
              title={`Allow the contract to take ${inSymbol}`}
              state={allowanceDone ? "done" : ready ? "todo" : "blocked"}
            >
              <p className="m-0 text-sm text-base-content/70">
                Current allowance: {allowance !== undefined ? formatToken(allowance, tokenIn!, inInfo) : "…"}
                {othersNeed > 0n &&
                  `, of which your other running plans on ${inSymbol} can still take ${formatToken(othersNeed, tokenIn!, inInfo)}`}
                .{unboundedShare && ` A running plan without an end also draws on it: stop it or raise this allowance.`}
                {ownerPlans.data?.truncated &&
                  " Only your newest plans were read: an older running plan on this token would also draw on it."}
              </p>
              {!sharingKnown && (
                <p className="m-0 text-sm text-warning">
                  {ownerPlans.isError
                    ? "Could not read your other plans, which share this allowance. Reload to try again."
                    : "Reading your other plans, which share this allowance…"}
                </p>
              )}
              {!allowanceDone && (
                <button
                  className="btn btn-sm btn-primary self-start"
                  disabled={busy !== null || !ready || !sharingKnown}
                  onClick={approve}
                >
                  {busy === "approve"
                    ? "Approving…"
                    : `Approve ${ready ? formatToken(neededAllowance, tokenIn!, inInfo) : ""}`}
                </button>
              )}
            </Step>
            <Step n={3} title="Start the plan" state={ready && allowanceDone && associationDone ? "todo" : "blocked"}>
              {inBalance !== undefined && !hasSlice && (
                <p className="m-0 text-sm text-warning">
                  You hold {formatToken(inBalance, tokenIn!, inInfo)}, less than one buy: the first tick would stop the
                  plan.
                </p>
              )}
              {account.data && deposit !== undefined && account.data.balanceTinybar < deposit && (
                <p className="m-0 text-sm text-warning">
                  You hold {formatHbar(account.data.balanceTinybar)}, less than the gas deposit.
                </p>
              )}
              <button
                className="btn btn-primary self-start"
                disabled={busy !== null || !ready || !allowanceDone || !associationDone || !hasSlice}
                onClick={start}
              >
                {busy === "start"
                  ? "Starting…"
                  : `Start plan${deposit !== undefined ? ` · deposit ${formatHbar(deposit)}` : ""}`}
              </button>
              <p className="m-0 text-xs text-base-content/60">
                The wallet only confirms that the plan was created. Whether each tick bought is known from its
                schedule&apos;s execution on the mirror node, which the next screen follows.
                {explorer && (
                  <>
                    {" "}
                    Contract:{" "}
                    <span className="break-all">
                      <ExternalLink href={`${explorer}/contract/${contract}`}>{contract}</ExternalLink>
                    </span>
                    .
                  </>
                )}
              </p>
            </Step>
          </ol>
        )}
      </Panel>
      {inBalance !== undefined && inBalance < total && hasSlice && (
        <p className="m-0 text-sm text-base-content/60">
          You hold {formatUnits(inBalance, inInfo?.decimals ?? 0)} {inSymbol}, enough for{" "}
          {(inBalance / amountPerTick).toString()} of {ticks.toString()} buys; the plan stops at the first tick it
          cannot pay for.
        </p>
      )}
    </div>
  );
};

const Created = ({ network, planId }: { network: RecurringBuyNetwork; planId: bigint }) => {
  const { data, isPending } = usePlan(network, planId);
  return (
    <Panel
      title={`Plan #${planId.toString()} started`}
      action={
        <Link href="/plans" className="btn btn-sm btn-outline">
          My plans
        </Link>
      }
    >
      <p className="m-0 mb-4 text-sm text-base-content/70">
        Below is what the mirror node shows for it, refreshed as ticks come due.
      </p>
      {data?.plan ? (
        <PlanDetails plan={data.plan} network={network} />
      ) : (
        <p className="m-0 text-base-content/60">
          {isPending ? "Reading the plan from the mirror node…" : "The mirror node has not indexed the plan yet."}
        </p>
      )}
    </Panel>
  );
};
