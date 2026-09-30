"use client";

import { useState } from "react";
import Link from "next/link";
import { PlanDetails } from "./PlanDetails";
import { ExternalLink, Panel, formatHbar, formatPeriod, formatToken } from "./common";
import { associateCalldata, buildWrapHbar, hederaIdToLongZeroAddress, minOut, tinybarToWeibar } from "@sh/saucerswap";
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
  type MirrorAccount,
  type RecurringBuyNetwork,
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
import { type SignStep, gasLimitFor, stepsToSign, tickCost } from "~~/utils/recurring-buy/costs";
import { type PlanParams, ticksRun } from "~~/utils/recurring-buy/plan";

/**
 * Gas limit of every tick. A tick of this contract that pulled, swapped and scheduled the next one used 1,605,224 gas
 * on testnet (docs/testnet-findings.md, E4); the contract keeps RESCHEDULE_GAS of it back for the next schedule.
 */
const TICK_GAS_LIMIT = 1_900_000n;
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
  const quote = useQuote(network, route, amountPerTick);
  const minAmountOut =
    quote.data && floorValid && quote.data.amountOut > 0n ? minOut(quote.data.amountOut, floorBps) : 0n;
  const total = amountPerTick * ticks;
  const spendIsWhbar = Boolean(tokenIn && tokenIn.toLowerCase() === network.saucerSwap?.whbar.toLowerCase());

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

  const { data: gasPrice } = useGasPrice(network);

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

  // Undefined while the account loads; a token missing from `tokens` is not associated.
  const held = account.data?.tokens ?? {};
  const inBalance = tokenIn && account.data ? (held[tokenIn.toLowerCase()] ?? 0n) : undefined;
  const inAssociated = Boolean(tokenIn && held[tokenIn.toLowerCase()] !== undefined);
  const outAssociated = Boolean(tokenOut && held[tokenOut.toLowerCase()] !== undefined);

  const steps = stepsToSign({
    spendIsWhbar,
    need: neededAllowance,
    tokenReady,
    wallet:
      address && account.data
        ? {
            holdsOut: outAssociated,
            holdsIn: inAssociated,
            balanceIn: inBalance,
            allowance: sharingKnown ? allowance : undefined,
          }
        : {},
  });
  const shortfall = address && account.data ? (steps.find(step => step.kind === "wrap")?.amount ?? 0n) : 0n;
  const showWrap = spendIsWhbar && (shortfall > 0n || wrapped);
  const wrapAmount = wrapInput === null ? shortfall : parseAmount(wrapInput, HBAR_DECIMALS);

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
  const run = async (step: SignStep["kind"], send: () => Promise<`0x${string}`>, after?: () => unknown) => {
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

  // The mirror node shows a transaction a few seconds after its receipt.
  const refetchAccountUntil = async (shows: (data: MirrorAccount | null | undefined) => boolean) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data } = await account.refetch();
      if (shows(data)) return;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  };

  const associate = (step: "associate-out" | "associate-in", token: string) =>
    run(
      step,
      async () => {
        const request = { account: address!, to: token, data: associateCalldata() };
        const gas = gasLimitFor(await publicClient!.estimateGas(request));
        return sendTransactionAsync({ to: token, data: request.data, gas, chainId, ...(await fees()) });
      },
      () => refetchAccountUntil(data => data?.tokens[token.toLowerCase()] !== undefined),
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
        await refetchAccountUntil(data => (data?.tokens[tokenIn!.toLowerCase()] ?? 0n) > before);
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
              <dt className="text-base-content/60">Transactions</dt>
              <dd className="m-0">
                <ol className="m-0 pl-5 list-decimal flex flex-col gap-1" data-testid="transactions">
                  {steps.map(step => (
                    <li key={step.kind}>
                      {stepLabel(step)}: {step.gas.toLocaleString()} gas
                      {gasPrice && <>, about {formatHbar(step.gas * gasPrice.ethereumTransaction)}</>}
                      {step.ifNeeded && <span className="text-base-content/60"> (skipped if already done)</span>}
                    </li>
                  ))}
                </ol>
                <p className="m-0 mt-1 text-xs text-base-content/60">
                  {gasPrice ? `About ${formatHbar(gasTotal * gasPrice.ethereumTransaction)} of gas in all` : "Gas"},
                  from what each transaction used on testnet
                  {gasPrice && `, at the network's price now of ${gasPrice.ethereumTransaction} tinybar per gas`}. Your
                  wallet may show a higher maximum fee: the relay adds a margin to the price.
                </p>
              </dd>
              <dt className="text-base-content/60">Gas per tick</dt>
              <dd className="m-0">
                {reservePerTick !== undefined ? (
                  <>
                    <b>{formatHbar(reservePerTick)}</b> reserved from the deposit ({tickGasLimit.toLocaleString()} gas ×{" "}
                    {reserveGasPrice?.toString()} tinybar, the contract&apos;s reserve price).
                    {gasPrice && (
                      <>
                        {" "}
                        A tick costs about {formatHbar(tickCost(gasPrice))} at today&apos;s gas price. The contract
                        charges the plan what the tick used and puts the rest of the reservation back into the deposit.
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
            <Step n={1} title={`Receive ${outSymbol}`} state={outAssociated ? "done" : "todo"}>
              {outAssociated ? (
                <p className="m-0 text-sm text-base-content/70">Your account is associated with {outSymbol}.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy !== null || !tokenOut}
                    onClick={() => associate("associate-out", tokenOut!)}
                  >
                    {busy === "associate-out" ? "Associating…" : `Associate ${outSymbol}`}
                  </button>
                  <span className="text-sm text-base-content/70">
                    An HTS token needs an association before you can receive it (HIP-719). Do it here even if your
                    account associates tokens automatically: a tick has no gas to spare for that.
                  </span>
                </div>
              )}
            </Step>
            {showWrap && (
              <Step n={2} title={`Get ${inSymbol}`} state={shortfall === 0n ? "done" : "todo"}>
                <p className="m-0 text-sm text-base-content/70" data-testid="wrap-balance">
                  A plan spends {inSymbol}, HBAR wrapped one to one. You hold{" "}
                  {formatToken(inBalance ?? 0n, tokenIn!, inInfo)}
                  {shortfall === 0n
                    ? ", enough for this plan."
                    : `; ${othersNeed > 0n ? "this plan and your other running plans on it need" : "this plan needs"} ${formatToken(neededAllowance, tokenIn!, inInfo)}.`}
                </p>
                {shortfall > 0n && (
                  <>
                    {!inAssociated && (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy !== null}
                          onClick={() => associate("associate-in", tokenIn!)}
                        >
                          {busy === "associate-in" ? "Associating…" : `Associate ${inSymbol}`}
                        </button>
                        <span className="text-sm text-base-content/70">First, so your account can hold it.</span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="input input-sm w-48">
                        <input
                          inputMode="decimal"
                          aria-label="HBAR to wrap"
                          value={wrapInput ?? formatUnits(shortfall, HBAR_DECIMALS)}
                          onChange={e => setWrapInput(e.target.value)}
                        />
                        <span className="text-base-content/60">HBAR</span>
                      </label>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy !== null || !inAssociated || wrapAmount <= 0n}
                        onClick={wrap}
                      >
                        {busy === "wrap"
                          ? "Wrapping…"
                          : `Wrap ${formatUnits(wrapAmount, HBAR_DECIMALS)} HBAR → ${inSymbol}`}
                      </button>
                    </div>
                    <p className="m-0 text-xs text-base-content/60">
                      Through SaucerSwap&apos;s WhbarHelper contract. You hold{" "}
                      {account.data ? formatHbar(account.data.balanceTinybar) : "…"}.
                    </p>
                  </>
                )}
              </Step>
            )}
            <Step
              n={showWrap ? 3 : 2}
              title={`Allow the contract to take ${inSymbol}`}
              state={allowanceDone ? "done" : ready && inAssociated ? "todo" : "blocked"}
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
                  disabled={busy !== null || !ready || !sharingKnown || !inAssociated}
                  onClick={approve}
                >
                  {busy === "approve"
                    ? "Approving…"
                    : `Approve ${ready ? formatToken(neededAllowance, tokenIn!, inInfo) : ""}`}
                </button>
              )}
            </Step>
            <Step
              n={showWrap ? 4 : 3}
              title="Start the plan"
              state={ready && allowanceDone && outAssociated ? "todo" : "blocked"}
            >
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
                disabled={busy !== null || !ready || !allowanceDone || !outAssociated || !hasSlice}
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
      {!showWrap && inBalance !== undefined && inBalance < total && hasSlice && (
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
