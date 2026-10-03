"use client";

import { Panel, formatAmount } from "./common";
import { formatUnits } from "viem";
import { useReferencePlan } from "~~/hooks/recurring-buy/useRecurringBuy";
import { axisTicks, cumulativeBought } from "~~/utils/recurring-buy/chart";

const W = 340;
const H = 240;
const PLOT = { left: 44, right: W - 10, top: 24, bottom: H - 46 };
/** Above this many points only the first and last are labelled. */
const MAX_LABELS = 6;

const seconds = (timestamp: string) => Number(timestamp.split(".")[0]);
const clock = (timestamp: string) =>
  new Date(seconds(timestamp) * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const day = (timestamp: string) =>
  new Date(seconds(timestamp) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The reference plan's running total of the bought token, one point per tick that ran. */
export const CumulativeChart = () => {
  const { plan, tokens } = useReferencePlan();
  const token = tokens.out;
  const symbol = token?.symbol ?? "token";

  if (!plan || !token) {
    return (
      <Panel title={`Cumulative ${symbol} received`}>
        <div className="h-56 rounded-xl bg-base-200 animate-pulse" />
      </Panel>
    );
  }
  const points = cumulativeBought(plan.ticks);
  const total = points.at(-1)?.total ?? 0n;
  const totalBox = (
    <div className="rounded-lg bg-base-200 px-2 py-1 text-[13px] leading-tight">
      <div className="text-xs text-base-content/60">Total</div>
      <b className="tabular-nums">
        {formatAmount(total, token.decimals)} {symbol}
      </b>
    </div>
  );
  if (!points.length) {
    return (
      <Panel title={`Cumulative ${symbol} received`} action={totalBox}>
        <p className="m-0 text-sm text-base-content/60">No tick has run yet.</p>
      </Panel>
    );
  }

  const values = points.map(point => Number(formatUnits(point.total, token.decimals)));
  const yTicks = axisTicks(Math.max(...values));
  const top = yTicks.at(-1)!;
  const [first, last] = [seconds(points[0].timestamp), seconds(points.at(-1)!.timestamp)];
  const inset = 14;
  const x = (timestamp: string) =>
    last === first
      ? (PLOT.left + PLOT.right) / 2
      : PLOT.left + inset + ((seconds(timestamp) - first) / (last - first)) * (PLOT.right - PLOT.left - 2 * inset);
  const y = (value: number) => PLOT.bottom - (value / top) * (PLOT.bottom - PLOT.top);
  const xy = points.map((point, i) => [x(point.timestamp), y(values[i])] as const);
  const line = xy.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
  const area = `${line} L${xy.at(-1)![0]},${PLOT.bottom} L${xy[0][0]},${PLOT.bottom} Z`;
  const labelled = (i: number) => points.length <= MAX_LABELS || i === 0 || i === points.length - 1;
  const firstDay = day(points[0].timestamp);
  const lastDay = day(points.at(-1)!.timestamp);

  return (
    <Panel title={<span className="text-sm">Cumulative {symbol} received</span>} action={totalBox}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-[12px]" role="img" aria-label={`${symbol} received`}>
        <defs>
          <linearGradient id="cumulative-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map(value => (
          <g key={value}>
            <line x1={PLOT.left} x2={PLOT.right} y1={y(value)} y2={y(value)} className="stroke-base-300" />
            <text x={PLOT.left - 6} y={y(value) + 3} textAnchor="end" className="fill-base-content/60">
              {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#cumulative-fill)" />
        <path
          d={line}
          pathLength={1}
          strokeDasharray={1}
          className="fill-none stroke-primary stroke-2 animate-draw motion-reduce:animate-none"
        />
        {xy.map(([px, py], i) => (
          <g key={points[i].tick}>
            <circle cx={px} cy={py} r={4} className="fill-primary stroke-base-100 stroke-2" />
            {labelled(i) && (
              <>
                <text
                  x={px + (i === 0 ? 6 : -6)}
                  y={i === 0 ? py + 16 : py - 8}
                  textAnchor={i === 0 ? "start" : "end"}
                  className="fill-primary font-medium"
                >
                  {values[i].toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                </text>
                <text x={px} y={PLOT.bottom + 16} textAnchor="middle" className="fill-base-content/60">
                  {clock(points[i].timestamp)}
                </text>
              </>
            )}
          </g>
        ))}
        <text x={(PLOT.left + PLOT.right) / 2} y={H - 8} textAnchor="middle" className="fill-base-content/60">
          {firstDay === lastDay ? firstDay : `${firstDay} – ${lastDay}`}
        </text>
      </svg>
    </Panel>
  );
};
