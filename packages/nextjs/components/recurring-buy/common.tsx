"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import type { TokenInfo } from "~~/hooks/recurring-buy/useRecurringBuy";
import { hederaIdOf } from "~~/utils/recurring-buy/mirror";

export const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="link link-hover">
    {children}
  </a>
);

/** An external link with the "opens elsewhere" mark, for tables of transactions. */
export const Linked = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <ExternalLink href={href}>
    {children}
    <ArrowTopRightOnSquareIcon className="inline size-3.5 ml-0.5 -mt-0.5" aria-hidden />
  </ExternalLink>
);

export const Panel = ({
  title,
  action,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="bg-base-100 rounded-2xl border border-base-300 p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 className="font-bold text-xl m-0">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

/** Unix seconds, updated every second while mounted. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** "42s", "9m 05s", "3h 02m", "2d 4h". */
export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

const UNITS: [number, string][] = [
  [604_800, "week"],
  [86_400, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
];

/** "every day", "every 90 seconds", "every 2 weeks". */
export function formatPeriod(seconds: bigint): string {
  const s = Number(seconds);
  const [size, unit] = UNITS.find(([size]) => s % size === 0) ?? [1, "second"];
  const count = s / size;
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

/** A mirror node consensus timestamp ("seconds.nanos") or unix seconds as "Sep 29, 14:05:17" in the viewer's zone. */
export function formatTime(timestamp: string | number): string {
  const seconds = typeof timestamp === "number" ? timestamp : Number(timestamp.split(".")[0]);
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Unix seconds as "Oct 1, 2026". */
export const formatDay = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Unix seconds as "11:34 AM". */
export const formatClock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "2.046098 SAUCE"; while the token is unknown, the raw amount and its id. */
export function formatToken(amount: bigint, token: string, info: TokenInfo | null | undefined): string {
  return info ? `${formatUnits(amount, info.decimals)} ${info.symbol}` : `${amount} (token ${hederaIdOf(token)})`;
}

/** "4,010.77", "1,004.10", "25": a token amount with 2 decimals unless it is whole. */
export function formatAmount(amount: bigint, decimals: number): string {
  const value = Number(formatUnits(amount, decimals));
  const digits = Number.isInteger(value) ? 0 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 });
}

/** HBAR from tinybar, rounded to 4 decimals for display. */
export const formatHbar = (tinybar: bigint) =>
  `${Number(formatUnits(tinybar, 8)).toLocaleString(undefined, { maximumFractionDigits: 4 })} HBAR`;
