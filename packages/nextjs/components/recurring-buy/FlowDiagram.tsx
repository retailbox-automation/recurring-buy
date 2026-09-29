import { ArrowPathIcon, ArrowsRightLeftIcon, ClockIcon, LockClosedIcon } from "@heroicons/react/24/outline";

const STEPS = [
  {
    icon: LockClosedIcon,
    title: "Limit",
    body: "You approve the contract for a capped amount of your token (HTS allowance). Funds stay in your wallet.",
  },
  {
    icon: ClockIcon,
    title: "Tick",
    body: "At the scheduled second, Hedera itself calls the contract (Schedule Service, HIP-1215). No keeper bot.",
  },
  {
    icon: ArrowsRightLeftIcon,
    title: "Swap",
    body: "The contract takes one slice and swaps it on SaucerSwap V2 straight to you, never below your price floor.",
  },
  {
    icon: ArrowPathIcon,
    title: "Next tick",
    body: "As its last step the tick schedules the next one, paid from the plan's gas deposit.",
  },
];

/** limit → tick → swap → next tick, left to right on wide screens and top to bottom on phones. */
export const FlowDiagram = () => (
  <ol className="grid grid-cols-1 md:grid-cols-4 gap-3 m-0 p-0 list-none">
    {STEPS.map(({ icon: Icon, title, body }, i) => (
      <li key={title} className="relative bg-base-100 border border-base-300 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="font-semibold">
            {i + 1}. {title}
          </span>
        </div>
        <p className="text-sm text-base-content/70 m-0">{body}</p>
        {i < STEPS.length - 1 && (
          <span
            aria-hidden
            className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 z-10 text-base-content/40 text-lg"
          >
            →
          </span>
        )}
      </li>
    ))}
  </ol>
);
