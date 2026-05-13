/**
 * Aggregation helpers that turn raw event lists into the shapes the UI needs.
 */
import type { SweepEvent, LedgerCreditEvent, LedgerSpentEvent, PaymasterOpEvent, CctpBurnEvent } from "./events";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./rpc";

export type Period = "24h" | "7d" | "30d" | "all";

const PERIOD_SECONDS: Record<Period, number | null> = {
  "24h": 24 * 3600,
  "7d": 7 * 24 * 3600,
  "30d": 30 * 24 * 3600,
  all: null,
};

export function filterByPeriod<T extends { blockTimestamp: number }>(events: T[], period: Period): T[] {
  const window = PERIOD_SECONDS[period];
  if (window === null) return events;
  const cutoff = Math.floor(Date.now() / 1000) - window;
  return events.filter((e) => e.blockTimestamp >= cutoff);
}

export function sumUsdc<T extends { netAmount?: bigint; shieldedAmount?: bigint; amount?: bigint }>(events: T[]): bigint {
  return events.reduce((acc, e) => {
    return acc + (e.netAmount ?? e.shieldedAmount ?? e.amount ?? 0n);
  }, 0n);
}

export function sumGasCost(events: PaymasterOpEvent[]): bigint {
  return events.reduce((acc, e) => acc + e.actualGasCost, 0n);
}

export function bucketDaily<T extends { blockTimestamp: number }>(
  events: T[],
  amountFn: (e: T) => bigint,
  days: number
): { day: string; chainBuckets: Record<SupportedChainId, number> }[] {
  const now = Math.floor(Date.now() / 1000);
  const startDay = Math.floor((now - days * 86400) / 86400) * 86400;
  const buckets = new Map<number, Record<SupportedChainId, number>>();
  for (let d = 0; d <= days; d++) {
    const dayStart = startDay + d * 86400;
    buckets.set(dayStart, {
      [SUPPORTED_CHAINS[0]]: 0,
      [SUPPORTED_CHAINS[1]]: 0,
      [SUPPORTED_CHAINS[2]]: 0,
    } as Record<SupportedChainId, number>);
  }
  for (const e of events) {
    const dayStart = Math.floor(e.blockTimestamp / 86400) * 86400;
    const bucket = buckets.get(dayStart);
    if (!bucket) continue;
    const chainId = (e as unknown as { chainId: SupportedChainId }).chainId;
    bucket[chainId] = (bucket[chainId] ?? 0) + Number(amountFn(e)) / 1e6;
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, chainBuckets]) => ({
      day: new Date(day * 1000).toISOString().slice(0, 10),
      chainBuckets,
    }));
}

export function bucketDailyEth<T extends { blockTimestamp: number }>(
  events: T[],
  amountFn: (e: T) => bigint,
  days: number
): { day: string; chainBuckets: Record<SupportedChainId, number> }[] {
  const now = Math.floor(Date.now() / 1000);
  const startDay = Math.floor((now - days * 86400) / 86400) * 86400;
  const buckets = new Map<number, Record<SupportedChainId, number>>();
  for (let d = 0; d <= days; d++) {
    const dayStart = startDay + d * 86400;
    buckets.set(dayStart, {
      [SUPPORTED_CHAINS[0]]: 0,
      [SUPPORTED_CHAINS[1]]: 0,
      [SUPPORTED_CHAINS[2]]: 0,
    } as Record<SupportedChainId, number>);
  }
  for (const e of events) {
    const dayStart = Math.floor(e.blockTimestamp / 86400) * 86400;
    const bucket = buckets.get(dayStart);
    if (!bucket) continue;
    const chainId = (e as unknown as { chainId: SupportedChainId }).chainId;
    bucket[chainId] = (bucket[chainId] ?? 0) + Number(amountFn(e)) / 1e18;
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, chainBuckets]) => ({
      day: new Date(day * 1000).toISOString().slice(0, 10),
      chainBuckets,
    }));
}

export function totalsByChain<T extends { chainId: SupportedChainId }>(
  events: T[],
  amountFn: (e: T) => bigint
): Record<SupportedChainId, bigint> {
  const totals = {
    [SUPPORTED_CHAINS[0]]: 0n,
    [SUPPORTED_CHAINS[1]]: 0n,
    [SUPPORTED_CHAINS[2]]: 0n,
  } as Record<SupportedChainId, bigint>;
  for (const e of events) {
    totals[e.chainId] = (totals[e.chainId] ?? 0n) + amountFn(e);
  }
  return totals;
}
