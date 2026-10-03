"use client";

import { Fragment } from "react";
import { ExternalLink, formatAmount, formatPeriod } from "./common";
import {
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
  <span className="rounded-lg bg-primary/10 text-primary text-sm px-3 py-1">{children}</span>
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
          <div className="flex justify-between text-xs text-base-content/60">
            <span>{amount(spent)} spent</span>
            <span>capped</span>
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
    <div className="self-stretch rounded-xl bg-success/15 border border-success/30 px-4 py-3 text-center">
      <div className="text-lg font-bold tabular-nums whitespace-nowrap">
        + {formatAmount(received, token.decimals)} {token.symbol}
      </div>
      <div className="text-sm text-base-content/70">delivered to your wallet</div>
    </div>
  );
};

/** An arrow between two steps; a dot runs along it for every tick the plan has run. */
const Connector = ({ pulses, offset, compact }: { pulses: number; offset: number; compact: boolean }) => (
  <li
    aria-hidden
    className={`relative shrink-0 self-center h-10 w-4 lg:h-4 lg:w-12 overflow-hidden text-primary/60 ${
      compact ? "" : "lg:self-end lg:mb-[5.25rem]"
    }`}
  >
    <span className="absolute left-1/2 top-0 h-full w-px lg:left-0 lg:top-1/2 lg:h-px lg:w-full bg-primary/30" />
    {Array.from({ length: pulses }, (_, i) => (
      <span
        key={i}
        className="absolute inset-0 animate-flow-y lg:animate-flow-x motion-reduce:hidden"
        style={{ animationDelay: `${offset + (i * PULSE_SECONDS) / pulses}s` }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 lg:left-0 lg:top-1/2 lg:translate-x-0 lg:-translate-y-1/2 size-1.5 rounded-full bg-primary" />
      </span>
    ))}
    <ChevronRightIcon className="absolute size-4 bottom-0 left-0 rotate-90 lg:rotate-0 lg:bottom-auto lg:left-auto lg:right-0 lg:top-0" />
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
      body: "Calls the contract at the scheduled second (HIP-1215). No keeper bot.",
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
            className={`flex-1 min-w-0 bg-base-100 border border-base-300 rounded-2xl flex flex-col gap-3 ${compact ? "p-3" : "p-4"}`}
          >
            <div className="flex gap-2.5">
              <span
                className={`rounded-full bg-primary/10 text-primary font-bold grid place-items-center shrink-0 ${
                  compact ? "size-11" : "size-8"
                }`}
              >
                {compact ? (
                  <Icon className="size-6" aria-hidden />
                ) : i < 4 ? (
                  i + 1
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-base m-0 leading-snug">{title}</h3>
                {compact && i === 2 && contractLink && <div className="text-sm">{contractLink}</div>}
                <p className="m-0 mt-1 text-[13px] leading-snug text-base-content/70">{compact ? brief : body}</p>
              </div>
            </div>
            {!compact && <div className="mt-auto lg:h-[6.5rem] flex flex-col items-center gap-3">{visual}</div>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
};
