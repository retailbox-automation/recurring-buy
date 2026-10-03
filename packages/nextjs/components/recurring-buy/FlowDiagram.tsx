"use client";

import { Fragment } from "react";
import { ExternalLink, formatAmount, formatPeriod } from "./common";
import {
  ArrowDownIcon,
  ArrowsRightLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentTextIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { type RecurringBuyNetwork, type TokenInfo, useContractId } from "~~/hooks/recurring-buy/useRecurringBuy";
import { boughtTotals } from "~~/utils/recurring-buy/chart";
import { type PlanView, ticksRun } from "~~/utils/recurring-buy/plan";

/** One pass of a pulse along a connector: the duration of `--animate-flow-x` in globals.css. */
const PULSE_SECONDS = 3.6;

const Bubble = ({ icon: Icon }: { icon: typeof ClockIcon }) => (
  <span className="size-14 rounded-full bg-primary/10 ring-8 ring-primary/5 text-primary grid place-items-center">
    <Icon className="size-7" aria-hidden />
  </span>
);

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="whitespace-nowrap rounded-lg bg-primary/10 text-primary text-xs 2xl:text-sm px-2.5 2xl:px-3 py-1">
    {children}
  </span>
);

const Placeholder = () => <div className="self-stretch h-24 rounded-xl bg-base-200 animate-pulse" />;

/** What the owner approved, and how much of it the plan has spent. */
const Allowance = ({ plan, token }: { plan: PlanView | null; token: TokenInfo | null | undefined }) => {
  if (!plan || !token) return <Placeholder />;
  const { amountPerTick, maxTicks } = plan.params;
  const cap = amountPerTick * maxTicks;
  const { spent } = boughtTotals(plan.ticks);
  const amount = (value: bigint) => `${formatAmount(value, token.decimals)} ${token.symbol}`;
  return (
    <div className="self-stretch rounded-xl bg-primary/5 border border-primary/10 px-3 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="size-10 rounded-full bg-base-100 text-primary grid place-items-center shrink-0">
          <WalletIcon className="size-6" aria-hidden />
        </span>
        <div className="leading-tight">
          <div className="font-bold">{maxTicks === 0n ? amount(amountPerTick) : amount(cap)}</div>
          <div className="text-sm text-base-content/60">{maxTicks === 0n ? "per buy, until stopped" : "allowance"}</div>
        </div>
      </div>
      {cap > 0n && (
        <>
          <progress className="progress progress-primary h-2" value={Number(spent)} max={Number(cap)} />
          <div className="text-xs text-base-content/60">
            {formatAmount(spent, token.decimals)} of {amount(cap)} spent
          </div>
        </>
      )}
    </div>
  );
};

/** What the plan has delivered so far. */
const Delivered = ({ plan, token }: { plan: PlanView | null; token: TokenInfo | null | undefined }) => {
  if (!plan || !token) return <Placeholder />;
  const { received } = boughtTotals(plan.ticks);
  return (
    <div className="self-stretch rounded-xl bg-success/15 border border-success/30 px-3 py-3 text-center">
      <div className="text-base 2xl:text-lg font-bold tabular-nums">
        <span className="whitespace-nowrap">+ {formatAmount(received, token.decimals)}</span> {token.symbol}
      </div>
      <div className="text-sm text-base-content/70 text-balance">delivered to your wallet</div>
    </div>
  );
};

/**
 * An arrow between two steps. In a row a dot runs along it for every tick the plan has run; in a column it is a plain
 * arrow down.
 */
const Connector = ({ pulses, offset, compact }: { pulses: number; offset: number; compact: boolean }) => (
  <li
    aria-hidden
    className={`shrink-0 self-center text-primary/60 ${compact ? "" : "lg:self-end lg:mb-20 2xl:mb-[5.25rem]"}`}
  >
    <ArrowDownIcon className="size-5 my-2 lg:hidden" />
    <span className="relative hidden lg:block h-4 w-8 2xl:w-12 overflow-hidden">
      <span className="absolute left-0 top-1/2 h-px w-full bg-primary/30" />
      {Array.from({ length: pulses }, (_, i) => (
        <span
          key={i}
          className="absolute inset-0 animate-flow-x motion-reduce:hidden"
          style={{ animationDelay: `${offset + (i * PULSE_SECONDS) / pulses}s` }}
        >
          <span className="absolute left-0 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-primary" />
        </span>
      ))}
      <ChevronRightIcon className="absolute size-4 right-0 top-0" />
    </span>
  </li>
);

/**
 * Wallet → Schedule Service → contract → pool → wallet, with a plan's numbers. `compact` drops the allowance and
 * delivery panels and shows each step's icon instead of its number.
 */
export const FlowDiagram = ({
  plan,
  tokens,
  network,
  compact = false,
}: {
  plan: PlanView | null;
  tokens: { in: TokenInfo | null | undefined; out: TokenInfo | null | undefined };
  network: RecurringBuyNetwork;
  compact?: boolean;
}) => {
  const { data: contractId } = useContractId(network);
  const { explorer } = network;
  const contractLink =
    contractId &&
    (explorer ? <ExternalLink href={`${explorer}/contract/${contractId}`}>{contractId}</ExternalLink> : contractId);

  const steps = [
    {
      icon: WalletIcon,
      title: "Your wallet",
      body: "Approve a capped amount. Funds stay in your wallet.",
      brief: "Funds stay in your wallet.",
      visual: <Allowance plan={plan} token={tokens.in} />,
    },
    {
      icon: ClockIcon,
      title: "Hedera Schedule Service",
      body: "Calls the contract at the scheduled second (HIP\u20111215). No keeper bot.",
      brief: plan ? `Wakes the contract ${formatPeriod(plan.params.period)}.` : "Wakes the contract.",
      visual: (
        <>
          <Bubble icon={ClockIcon} />
          <Chip>Wakes the contract</Chip>
        </>
      ),
    },
    {
      icon: DocumentTextIcon,
      title: "RecurringBuy contract",
      body: "Takes one buy's worth and swaps it on SaucerSwap V2, never below the floor.",
      brief: "Takes one buy's worth and swaps it.",
      visual: (
        <>
          <Bubble icon={DocumentTextIcon} />
          {contractLink && <Chip>{contractLink}</Chip>}
        </>
      ),
    },
    {
      icon: ArrowsRightLeftIcon,
      title: "SaucerSwap V2 pool",
      body: "Swaps at the pool's current price.",
      brief: "Swaps at the current price, never below your floor.",
      visual: <Bubble icon={ArrowsRightLeftIcon} />,
    },
    {
      icon: WalletIcon,
      title: "Your wallet",
      body: "Each buy arrives straight from the pool.",
      brief: `${tokens.out?.symbol ?? "The token"} goes straight to your wallet.`,
      visual: <Delivered plan={plan} token={tokens.out} />,
    },
  ];
  const pulses = plan ? ticksRun(plan.ticks) : 0;

  return (
    <ol className="m-0 p-0 list-none flex flex-col lg:flex-row">
      {steps.map(({ icon: Icon, title, body, brief, visual }, i) => (
        <Fragment key={i}>
          {i > 0 && <Connector pulses={pulses} offset={(i - 1) * 0.6} compact={compact} />}
          <li
            className={`flex-1 min-w-0 bg-base-100 border border-base-300 rounded-2xl flex flex-col gap-3 ${
              compact ? "p-3" : "p-4 lg:p-3 2xl:p-4"
            }`}
          >
            {/* Below 2xl the text runs under the number at the card's full width; from 2xl it sits beside it. */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5">
              <span
                className={`rounded-full bg-primary/10 text-primary font-bold grid place-items-center 2xl:row-span-2 2xl:self-start ${
                  compact ? "size-9 2xl:size-11" : "size-8"
                }`}
              >
                {compact ? (
                  <Icon className="size-5 2xl:size-6" aria-hidden />
                ) : i < 4 ? (
                  i + 1
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
              </span>
              <h3
                className={`m-0 font-bold 2xl:text-base leading-snug text-balance ${compact ? "text-sm" : "text-[15px]"}`}
              >
                {title}
              </h3>
              <div className="col-span-2 2xl:col-span-1 2xl:col-start-2 text-[13px] lg:text-xs 2xl:text-[13px] leading-snug text-pretty text-base-content/70">
                {compact && i === 2 && contractLink && <div className="text-sm text-base-content">{contractLink}</div>}
                <p className="m-0">{compact ? brief : body}</p>
              </div>
            </div>
            {!compact && <div className="mt-auto lg:min-h-[6.5rem] flex flex-col items-center gap-3">{visual}</div>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
};
