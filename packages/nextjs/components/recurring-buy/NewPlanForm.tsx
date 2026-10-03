"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { PlanDetails } from "./PlanDetails";
import { ExternalLink, Panel, Warning, formatHbar, formatPeriod, formatToken, shortAddress } from "./common";
import { associateCalldata, buildWrapHbar, hederaIdToLongZeroAddress, minOut, tinybarToWeibar } from "@sh/saucerswap";
import { type Address, erc20Abi, formatUnits, getAddress, isAddress, parseEventLogs, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSendTransaction,
  useWriteContract,
} from "wagmi";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  CheckIcon,
  InformationCircleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import {
  type RecurringBuyNetwork,
  type TokenInfo,
  defaultRoute,
  useGasPrice,
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
import {
  type SignStep,
  type WalletState,
  gasLimitFor,
  stepsToSign,
  tickCost,
  walletState,
} from "~~/utils/recurring-buy/costs";
import { type MirrorAccount, hederaIdOf } from "~~/utils/recurring-buy/mirror";
import { type PlanParams, ticksRun } from "~~/utils/recurring-buy/plan";

/**
 * Gas limit of every tick. A tick of this contract that pulled, swapped and scheduled the next one used 1,605,224 gas
 * on testnet (docs/testnet-findings.md, E4); the contract keeps RESCHEDULE_GAS of it back for the next schedule.
 */
const TICK_GAS_LIMIT = 1_900_000n;
/** Gas the tick gas limit keeps above RESCHEDULE_GAS for the pull and the swap; `buy` gets a little less (D3, F2). */
const BUY_GAS = 300_000n;
/** HBAR and WHBAR both have 8 decimals. */
const HBAR_DECIMALS = 8;

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

/** "0.0.N" or an EVM address as an EVM address; null when it is neither, or when N is too large for an address. */
function toTokenAddress(input: string): Address | null {
  const value = input.trim();
  if (/^0\.0\.\d+$/.test(value)) {
    try {
      return hederaIdToLongZeroAddress(value);
    } catch {
      return null;
    }
  }
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
    tokenIn: route ? hederaIdOf(route.tokenIn) : "",
    tokenOut: route ? hederaIdOf(route.tokenOut) : "",
    fee: String(route?.fee ?? 3000),
    amount: "0.05",
    every: "1",
    unit: "days",
    ticks: "4",
    floorPercent: "5",
  };
}

const Field = ({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) => (
  <fieldset className={`fieldset p-0 ${className}`}>
    <legend className="fieldset-legend text-sm">{label}</legend>
    {children}
    {hint && <p className="label m-0 whitespace-normal">{hint}</p>}
  </fieldset>
);

/** A token field: its symbol and decimals once the mirror node knows it, over the id or address typed in. */
const TokenField = ({
  label,
  value,
  onChange,
  info,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  info: TokenInfo | null | undefined;
}) => (
  <Field label={label} className="sm:col-span-3">
    <label className="input w-full h-auto py-2 flex-col items-start gap-0 rounded-xl">
      <span className="font-bold leading-tight">{info?.symbol ?? "HTS token id or address"}</span>
      <span className="flex w-full items-center gap-1 text-xs text-base-content/60">
        <input
          className="grow min-w-0"
          aria-label={`${label} token`}
          value={value}
          onChange={onChange}
          spellCheck={false}
        />
        {info && <span className="shrink-0">· {info.decimals} decimals</span>}
      </span>
    </label>
  </Field>
);

type StepState = "done" | "todo" | "blocked";

/** A step's button; disabled it stays readable, in the theme's base colors. */
const ACTION =
  "btn btn-sm btn-primary w-full h-auto min-h-8 py-1.5 leading-tight disabled:bg-base-300 disabled:text-base-content/60";

const Step = ({
  n,
  title,
  state,
  current,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  /** The first step still to do. */
  current: boolean;
  children: React.ReactNode;
}) => (
  <li
    className={`relative flex-1 min-w-0 rounded-2xl border p-4 flex flex-col gap-2 ${
      current
        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
        : state === "done"
          ? "border-success/40 bg-success/5"
          : "border-base-300 bg-base-100"
    }`}
  >
    <div className="flex items-center gap-3">
      <span
        className={`size-8 shrink-0 rounded-full grid place-items-center text-sm font-bold ${
          state === "done"
            ? "bg-success text-success-content"
            : current
              ? "bg-primary text-primary-content"
              : "bg-base-200 text-base-content/70"
        }`}
      >
        {state === "done" ? <CheckIcon className="size-4" aria-hidden /> : n}
      </span>
      <span className={`font-semibold ${current ? "text-primary" : state === "blocked" ? "text-base-content/60" : ""}`}>
        {title}
      </span>
      {state === "blocked" && <LockClosedIcon className="size-4 ml-auto shrink-0 text-base-content/40" aria-hidden />}
    </div>
    {current && <span className="absolute -top-2.5 right-4 badge badge-sm badge-primary">Current step</span>}
    {children}
  </li>
);

const StepArrow = () => (
  <li aria-hidden className="self-center text-primary/70 px-2 py-1">
    <ArrowDownIcon className="size-5 lg:hidden" />
    <ArrowRightIcon className="size-6 hidden lg:block" />
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
        There is no RecurringBuy on {network.networkName} yet. Deploy one with the <code>hardhat:deploy:testnet</code>{" "}
        or <code>foundry:deploy:testnet</code> script, or set <code>referencePlan.contract</code> in{" "}
        <code>packages/nextjs/scaffold.config.ts</code> to a deployed one.
      </p>
    )}
  </Panel>
);

/** Form, cost disclosure and the transactions that start a plan: associations, WHBAR, allowance, start. */
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
  const [busy, setBusy] = useState<SignStep["kind"] | null>(null);
  const [createdPlanId, setCreatedPlanId] = useState<bigint | null>(null);
  // What the person typed into the wrap amount; null shows what the plan is short of.
  const [wrapInput, setWrapInput] = useState<string | null>(null);
  const [wrapped, setWrapped] = useState(false);

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
  const quote = useQuote(network, route, amountPerTick);
  const minAmountOut =
    quote.data && floorValid && quote.data.amountOut > 0n ? minOut(quote.data.amountOut, floorBps) : 0n;
  const total = amountPerTick * ticks;
  const spendIsWhbar = Boolean(tokenIn && tokenIn.toLowerCase() === network.saucerSwap?.whbar.toLowerCase());

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
    rescheduleGas !== undefined && rescheduleGas + BUY_GAS > TICK_GAS_LIMIT ? rescheduleGas + BUY_GAS : TICK_GAS_LIMIT;
  const reservePerTick = reserveGasPrice !== undefined ? tickGasLimit * reserveGasPrice : undefined;
  const deposit = reservePerTick !== undefined ? reservePerTick * ticks : undefined;

  const { data: gasPrice, isError: gasPriceFailed } = useGasPrice(network);

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

  // Empty while the account loads.
  const wallet: WalletState =
    address && account.data
      ? walletState(account.data, { tokenIn, tokenOut, allowance: sharingKnown ? allowance : undefined })
      : {};
  const inBalance = wallet.balanceIn;
  const inAssociated = wallet.associatedIn === true;
  const outAssociated = wallet.associatedOut === true;

  const steps = stepsToSign({ spendIsWhbar, need: neededAllowance, tokenReady, wallet });
  const shortfall = address && account.data ? (steps.find(step => step.kind === "wrap")?.amount ?? 0n) : 0n;
  const showWrap = spendIsWhbar && (shortfall > 0n || wrapped);
  const wrapAmount = wrapInput === null ? shortfall : parseAmount(wrapInput, HBAR_DECIMALS);

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
  const allowanceDone = allowance !== undefined && ready && sharingKnown && allowance >= neededAllowance;
  const coversOneBuy = inBalance !== undefined && inBalance >= amountPerTick;

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

  const run = async (step: SignStep["kind"], send: () => Promise<`0x${string}`>, after?: () => unknown) => {
    setBusy(step);
    try {
      // useTransactor returns no hash, without throwing, when there is no wallet client.
      if (await writeTx(send)) await after?.();
    } catch {
      // useTransactor has shown the error.
    } finally {
      setBusy(null);
    }
  };

  // The mirror node shows a transaction a few seconds after its receipt.
  const refetchAccountUntil = async (shows: (data: MirrorAccount | null | undefined) => boolean) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data } = await account.refetch();
      if (shows(data)) return;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  };

  const associate = (step: "associate-out" | "associate-in", token: Address) =>
    run(
      step,
      async () => {
        const request = { account: address!, to: token, data: associateCalldata() };
        const gas = gasLimitFor(await publicClient!.estimateGas(request));
        return sendTransactionAsync({ to: token, data: request.data, gas, chainId, ...(await fees()) });
      },
      () => refetchAccountUntil(data => data?.tokens[hederaIdOf(token)] !== undefined),
    );

  const wrap = () => {
    const before = inBalance ?? 0n;
    return run(
      "wrap",
      async () => {
        const request = { account: address!, ...buildWrapHbar(network.saucerSwap!, wrapAmount) };
        const gas = gasLimitFor(await publicClient!.estimateGas(request));
        const { to, data, value } = request;
        return sendTransactionAsync({ to, data, value, gas, chainId, ...(await fees()) });
      },
      async () => {
        setWrapped(true);
        setWrapInput(null);
        await refetchAccountUntil(data => (data?.tokens[hederaIdOf(tokenIn!)] ?? 0n) > before);
      },
    );
  };

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
        const gas = gasLimitFor(await publicClient!.estimateContractGas(request));
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
        value: tinybarToWeibar(deposit!),
      } as const;
      const gas = gasLimitFor(await publicClient!.estimateContractGas(request));
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

  const stepLabel = (step: SignStep): string => {
    switch (step.kind) {
      case "associate-out":
        return `Associate ${outSymbol}, so your account can receive it`;
      case "associate-in":
        return `Associate ${inSymbol}, so your account can hold it`;
      case "wrap":
        return step.ifNeeded
          ? `Wrap HBAR into ${inSymbol}, as much as you are short of`
          : `Wrap ${formatHbar(step.amount ?? 0n)} into ${inSymbol}`;
      case "approve":
        return `Approve the contract for ${formatToken(neededAllowance, tokenIn!, inInfo)}`;
      case "start":
        return tokenReady === false
          ? `Start the plan and pay its gas deposit. The first plan on ${inSymbol} also has the contract associate it and approve SaucerSwap's router`
          : "Start the plan and pay its gas deposit";
    }
  };
  const gasTotal = steps.reduce((sum, step) => sum + step.gas, 0n);

  const receiveState: StepState = outAssociated ? "done" : "todo";
  const wrapState: StepState = shortfall === 0n ? "done" : "todo";
  const allowState: StepState = allowanceDone ? "done" : ready && (inAssociated || !showWrap) ? "todo" : "blocked";
  const startState: StepState = ready && allowanceDone && outAssociated ? "todo" : "blocked";
  const signSteps = [
    { key: "receive", state: receiveState },
    ...(showWrap ? [{ key: "wrap", state: wrapState }] : []),
    { key: "allow", state: allowState },
    { key: "start", state: startState },
  ];
  const current = signSteps.find(step => step.state === "todo")?.key;
  const stepProps = (key: string) => {
    const index = signSteps.findIndex(step => step.key === key);
    return { n: index + 1, state: signSteps[index].state, current: current === key };
  };

  const receiveStep = (
    <Step title={`Receive ${outSymbol}`} {...stepProps("receive")}>
      {outAssociated ? (
        <p className="m-0 text-sm text-base-content/70">Your account is associated with {outSymbol}.</p>
      ) : (
        <>
          <button
            className={ACTION}
            disabled={busy !== null || !tokenOut}
            onClick={() => associate("associate-out", tokenOut!)}
          >
            {busy === "associate-out" ? "Associating…" : `Associate ${outSymbol}`}
          </button>
          <p className="m-0 text-xs text-base-content/70">
            An HTS token needs an association before you can receive it (HIP-719). Do it here even if your account
            associates tokens automatically: a tick has no gas to spare for that.
          </p>
        </>
      )}
    </Step>
  );

  const wrapStep = showWrap && (
    <Step title={`Get ${inSymbol}`} {...stepProps("wrap")}>
      <p className="m-0 text-sm text-base-content/70" data-testid="wrap-balance">
        A plan spends {inSymbol}, HBAR wrapped one to one. You hold {formatToken(inBalance ?? 0n, tokenIn!, inInfo)}
        {shortfall === 0n
          ? ", enough for this plan."
          : `; ${othersNeed > 0n ? "this plan and your other running plans on it need" : "this plan needs"} ${formatToken(neededAllowance, tokenIn!, inInfo)}.`}
      </p>
      {shortfall > 0n && (
        <>
          {!inAssociated && (
            <>
              <button className={ACTION} disabled={busy !== null} onClick={() => associate("associate-in", tokenIn!)}>
                {busy === "associate-in" ? "Associating…" : `Associate ${inSymbol}`}
              </button>
              <p className="m-0 text-xs text-base-content/70">First, so your account can hold it.</p>
            </>
          )}
          <label className="input input-sm w-full">
            <input
              inputMode="decimal"
              aria-label="HBAR to wrap"
              value={wrapInput ?? formatUnits(shortfall, HBAR_DECIMALS)}
              onChange={e => setWrapInput(e.target.value)}
            />
            <span className="text-base-content/60">HBAR</span>
          </label>
          <button className={ACTION} disabled={busy !== null || !inAssociated || wrapAmount <= 0n} onClick={wrap}>
            {busy === "wrap" ? "Wrapping…" : `Wrap ${formatUnits(wrapAmount, HBAR_DECIMALS)} HBAR → ${inSymbol}`}
          </button>
          <p className="m-0 text-xs text-base-content/60">
            Through SaucerSwap&apos;s WhbarHelper contract. You hold{" "}
            {account.data ? formatHbar(account.data.balanceTinybar) : "…"}.
          </p>
        </>
      )}
    </Step>
  );

  const allowStep = (
    <Step title={`Allow the contract to take ${inSymbol}`} {...stepProps("allow")}>
      <p className="m-0 text-sm text-base-content/70">
        Current allowance: {allowance !== undefined ? formatToken(allowance, tokenIn!, inInfo) : "…"}
        {othersNeed > 0n &&
          `, of which your other running plans on ${inSymbol} can still take ${formatToken(othersNeed, tokenIn!, inInfo)}`}
        .{unboundedShare && ` A running plan without an end also draws on it: stop it or raise this allowance.`}
        {ownerPlans.data?.truncated &&
          " Only your newest plans were read: an older running plan on this token would also draw on it."}
      </p>
      {!sharingKnown && (
        <Warning>
          {ownerPlans.isError
            ? "Could not read your other plans, which share this allowance. Reload to try again."
            : "Reading your other plans, which share this allowance…"}
        </Warning>
      )}
      {!allowanceDone && !inAssociated && !showWrap && tokenIn && (
        <>
          <button className={ACTION} disabled={busy !== null} onClick={() => associate("associate-in", tokenIn)}>
            {busy === "associate-in" ? "Associating…" : `Associate ${inSymbol}`}
          </button>
          <p className="m-0 text-xs text-base-content/70">
            First, so your account can hold {inSymbol} and approve the contract on it.
          </p>
        </>
      )}
      {!allowanceDone && (
        <button
          className={ACTION}
          disabled={busy !== null || !ready || !sharingKnown || !inAssociated}
          onClick={approve}
        >
          {busy === "approve" ? "Approving…" : `Approve ${ready ? formatToken(neededAllowance, tokenIn!, inInfo) : ""}`}
        </button>
      )}
      <p className="m-0 text-xs text-base-content/60">
        The contract can take up to this much, one buy at a time. Revoke any time by approving 0.
      </p>
    </Step>
  );

  const startStep = (
    <Step title="Start plan" {...stepProps("start")}>
      <p className="m-0 text-sm text-base-content/70">Pay the gas deposit to start the plan.</p>
      {inBalance !== undefined && !coversOneBuy && (
        <Warning>
          You hold {formatToken(inBalance, tokenIn!, inInfo)}, less than one buy: the first tick would stop the plan.
        </Warning>
      )}
      {account.data && deposit !== undefined && account.data.balanceTinybar < deposit && (
        <Warning>You hold {formatHbar(account.data.balanceTinybar)}, less than the gas deposit.</Warning>
      )}
      <button
        className={ACTION}
        disabled={busy !== null || !ready || !allowanceDone || !outAssociated || !coversOneBuy}
        onClick={start}
      >
        {busy === "start"
          ? "Starting…"
          : `Start plan${deposit !== undefined ? ` · deposit ${formatHbar(deposit)}` : ""}`}
      </button>
      <p className="m-0 text-xs text-base-content/60">Hedera Schedule Service will run your buys automatically.</p>
    </Step>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Panel title="1. Describe the plan">
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-x-4 gap-y-3">
            <TokenField label="Spend" value={form.tokenIn} onChange={set("tokenIn")} info={inInfo} />
            <TokenField label="Buy" value={form.tokenOut} onChange={set("tokenOut")} info={outInfo} />
            <Field label="Amount per buy" className="sm:col-span-2 content-end">
              <label className="input w-full">
                <input inputMode="decimal" value={form.amount} onChange={set("amount")} />
                <span className="text-base-content/60">{inSymbol}</span>
              </label>
            </Field>
            <Field label="SaucerSwap V2 pool fee" className="sm:col-span-2 content-end">
              <select className="select w-full" value={form.fee} onChange={set("fee")}>
                <option value="500">0.05%</option>
                <option value="1500">0.15%</option>
                <option value="3000">0.3%</option>
                <option value="10000">1%</option>
              </select>
            </Field>
            <Field label="Every" className="sm:col-span-2 content-end">
              <div className="flex gap-2">
                <input className="input w-14 shrink-0" inputMode="numeric" value={form.every} onChange={set("every")} />
                <select className="select min-w-0 grow" value={form.unit} onChange={set("unit")}>
                  {Object.keys(PERIOD_UNITS).map(unit => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Number of buys" className="sm:col-span-2">
              <input className="input w-full" inputMode="numeric" value={form.ticks} onChange={set("ticks")} />
            </Field>
            <Field
              label="Price floor, % below today's quote"
              hint="A tick that would get less is skipped: nothing is taken, and the next tick is still scheduled."
              className="sm:col-span-4"
            >
              <label className="input w-full">
                <input inputMode="decimal" value={form.floorPercent} onChange={set("floorPercent")} />
                <span className="text-base-content/60">%</span>
              </label>
            </Field>
          </div>
        </Panel>

        <Panel title="2. Check what you sign">
          {problems.length > 0 ? (
            <ul className="m-0 pl-8 list-disc bg-warning text-warning-content rounded-xl py-3 pr-4 text-sm">
              {problems.map(problem => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              <div className="rounded-xl bg-primary/5 border border-primary/10 p-4 flex flex-col gap-3">
                <p className="m-0 text-base font-bold">
                  Buy {outSymbol} with {formatToken(amountPerTick, tokenIn!, inInfo)} {formatPeriod(period)},{" "}
                  {ticks.toString()} {ticks === 1n ? "time" : "times"}.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 m-0">
                  <div>
                    <dt className="text-base-content/60">Quote now</dt>
                    <dd className="m-0">
                      <b>{quote.data ? formatToken(quote.data.amountOut, tokenOut!, outInfo) : "…"}</b> per buy
                      (SaucerSwap QuoterV2)
                    </dd>
                  </div>
                  <div className="sm:border-l sm:border-base-300 sm:pl-3">
                    <dt className="text-base-content/60">Price floor</dt>
                    <dd className="m-0">
                      {minAmountOut > 0n ? (
                        <>
                          at least <b>{formatToken(minAmountOut, tokenOut!, outInfo)}</b> per buy
                        </>
                      ) : (
                        "…"
                      )}
                    </dd>
                  </div>
                  <div className="sm:border-l sm:border-base-300 sm:pl-3">
                    <dt className="text-base-content/60">Allowance</dt>
                    <dd className="m-0">
                      up to <b>{formatToken(total, tokenIn!, inInfo)}</b> in total, taken one buy at a time. Revoke any
                      time by approving 0.
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-sm font-semibold">Transactions to sign ({steps.length})</h3>
                <ol className="m-0 p-0 list-none flex flex-col" data-testid="transactions">
                  {steps.map((step, i) => {
                    const cost = gasPrice && `≈ ${formatHbar(step.gas * gasPrice.ethereumTransaction)}`;
                    return (
                      <li
                        key={step.kind}
                        className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:grid-cols-[1.5rem_minmax(0,1fr)_auto_7rem] gap-x-3 py-1.5 border-b border-base-200"
                      >
                        <span className="text-base-content/60">{i + 1}.</span>
                        <span>
                          {stepLabel(step)}
                          {step.ifNeeded && <span className="text-base-content/60"> (skipped if already done)</span>}
                        </span>
                        <span className="text-right tabular-nums whitespace-nowrap">
                          {step.gas.toLocaleString()} gas
                          {cost && <span className="block sm:hidden text-base-content/60">{cost}</span>}
                        </span>
                        {cost && (
                          <span className="hidden sm:block text-right tabular-nums whitespace-nowrap">{cost}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {gasPrice && (
                  <p className="m-0 rounded-lg bg-primary/5 px-3 py-2">
                    About <b>{formatHbar(gasTotal * gasPrice.ethereumTransaction)}</b> of gas in all.
                  </p>
                )}
                <p className="m-0 text-xs text-base-content/60">
                  Gas as each transaction used on testnet
                  {gasPrice && `, at the network's ${gasPrice.ethereumTransaction} tinybar per gas now`}. Your wallet
                  shows a higher maximum fee (the estimate plus 20%, at the relay&apos;s price); the network bills the
                  gas used.
                </p>
                {!gasPrice && gasPriceFailed && (
                  <Warning>
                    Gas price unavailable: the mirror node&apos;s /network/fees did not answer, so the transactions and
                    the tick are shown in gas only.
                  </Warning>
                )}
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 sm:gap-y-2 m-0 [&>dd]:mb-2 sm:[&>dd]:mb-0">
                <dt className="font-semibold">Gas per tick</dt>
                <dd className="m-0 text-base-content/80">
                  {reservePerTick !== undefined ? (
                    <>
                      <b>{formatHbar(reservePerTick)}</b> reserved from the deposit ({tickGasLimit.toLocaleString()} gas
                      × {reserveGasPrice?.toString()} tinybar, the contract&apos;s reserve price)
                      {gasPrice && <>; a tick costs about {formatHbar(tickCost(gasPrice))} at today&apos;s gas price</>}
                      . The plan is charged what the tick used, and the rest goes back into the deposit.
                    </>
                  ) : (
                    "…"
                  )}
                </dd>
                <dt className="font-semibold">Gas deposit</dt>
                <dd className="m-0 text-base-content/80">
                  {deposit !== undefined ? (
                    <>
                      <b>{formatHbar(deposit)}</b>, one reservation for each of the {ticks.toString()} ticks, paid with
                      the start transaction. What the ticks do not use is yours to withdraw when the plan ends; stop
                      early and the pending tick&apos;s reservation comes back too, if Hedera deletes that schedule.
                    </>
                  ) : (
                    "…"
                  )}
                </dd>
              </dl>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="3. Sign">
        {!address ? (
          <p className="m-0">Connect a wallet on {network.networkName} with the button at the top right.</p>
        ) : !onNetwork ? (
          <p className="m-0">Switch your wallet to {network.networkName}.</p>
        ) : account.data === null ? (
          <p className="m-0">
            This address has no Hedera account yet. Send it some HBAR (for example from the faucet) to create one.
          </p>
        ) : account.data === undefined ? (
          account.isError ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-error">
                Could not read your account from the mirror node, so which of these transactions you still need is
                unknown: {account.error.message}
              </p>
              <button className="btn btn-sm btn-outline self-start" onClick={() => account.refetch()}>
                Try again
              </button>
            </div>
          ) : (
            <p className="m-0 text-base-content/60">Reading your account from the mirror node…</p>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <ol className="m-0 p-0 list-none flex flex-col lg:flex-row items-stretch">
              {[receiveStep, wrapStep, allowStep, startStep].filter(Boolean).map((step, i) => (
                <Fragment key={i}>
                  {i > 0 && <StepArrow />}
                  {step}
                </Fragment>
              ))}
            </ol>
            <p className="m-0 flex items-start gap-2 rounded-xl bg-primary/10 text-primary dark:text-base-content px-4 py-2.5 text-sm">
              <InformationCircleIcon className="size-5 shrink-0 text-primary" aria-hidden />
              <span>
                The wallet only confirms that the plan was created. Whether each tick bought is known from its
                schedule&apos;s execution on the mirror node, which the next screen follows.
                {explorer && (
                  <>
                    {" "}
                    Contract{" "}
                    <ExternalLink href={`${explorer}/contract/${contract}`}>{shortAddress(contract)}</ExternalLink>.
                  </>
                )}
              </span>
            </p>
          </div>
        )}
      </Panel>
      {!showWrap && inBalance !== undefined && inBalance < total && coversOneBuy && (
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
