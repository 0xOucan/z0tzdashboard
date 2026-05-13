/**
 * Higher-order aggregations: cumulative curves, hour-of-day, op-class buckets.
 */
import { SUPPORTED_CHAINS, type SupportedChainId } from "./rpc";

type Stamped<T = unknown> = T & { chainId: SupportedChainId; blockTimestamp: number };

export function cumulative<T extends Stamped>(
  events: T[],
  amountFn: (e: T) => number,
  days: number
): { day: string; value: number }[] {
  const now = Math.floor(Date.now() / 1000);
  const startDay = Math.floor((now - days * 86400) / 86400) * 86400;
  const daily = new Map<number, number>();
  for (let d = 0; d <= days; d++) daily.set(startDay + d * 86400, 0);
  for (const e of events) {
    const dayStart = Math.floor(e.blockTimestamp / 86400) * 86400;
    if (!daily.has(dayStart)) continue;
    daily.set(dayStart, (daily.get(dayStart) ?? 0) + amountFn(e));
  }
  const sorted = Array.from(daily.entries()).sort((a, b) => a[0] - b[0]);
  let running = 0;
  return sorted.map(([day, v]) => {
    running += v;
    return { day: new Date(day * 1000).toISOString().slice(0, 10), value: running };
  });
}

export function hourOfDay<T extends Stamped>(events: T[]): { hour: number; count: number }[] {
  const buckets = new Array(24).fill(0);
  for (const e of events) {
    if (e.blockTimestamp <= 0) continue;
    const hour = new Date(e.blockTimestamp * 1000).getUTCHours();
    buckets[hour] += 1;
  }
  return buckets.map((count, hour) => ({ hour, count }));
}

/**
 * Classify a UserOp by its gas used into a coarse bucket. Decoder-free
 * heuristic — buckets calibrated against the V6.5 super-run benchmark
 * (/Z0tz/benchmarks/2026-05-02-v65-defi-super.md):
 *
 *   defi-tezcatli-deposit   ~1.71M gas
 *   defi-tezcatli-withdraw  ~929K
 *   xc-cashout              ~761K
 *   defi-ledger-cashout     ~761K
 *   cashin (V2 sweep)       ~633K
 *   dst-sweep-to-ledger     ~530K
 *   stealth-unshield        ~500K
 *
 * Don't read too much into individual classifications — these are buckets
 * for the donut, not authoritative op types. Cross-reference the tx hash
 * on the explorer for exact decode.
 */
export type OpClass = "defiDeposit" | "defiWithdraw" | "cashout" | "cashin" | "other";

const OP_CLASS_COLORS: Record<OpClass, string> = {
  defiDeposit: "#a78bfa",
  defiWithdraw: "#f472b6",
  cashout: "#fbbf24",
  cashin: "#34d399",
  other: "#6b7280",
};

export function classifyByGas(gasUsed: bigint): OpClass {
  const g = Number(gasUsed);
  if (g >= 1_500_000) return "defiDeposit";   // ~1.71M Tezcatli deposit
  if (g >= 900_000)  return "defiWithdraw";   // ~929K Tezcatli withdraw
  if (g >= 700_000)  return "cashout";        // ~761K xc-cashout / defi-ledger-cashout
  if (g >= 450_000)  return "cashin";         // ~633K V2 sweep, ~530K dst-sweep, ~500K unshield
  return "other";
}

export function opClassColor(c: OpClass): string {
  return OP_CLASS_COLORS[c];
}

export function bucketByOpClass(ops: { actualGasUsed: bigint; actualGasCost: bigint }[]): {
  klass: OpClass;
  count: number;
  totalCost: bigint;
}[] {
  const buckets = new Map<OpClass, { count: number; totalCost: bigint }>();
  for (const op of ops) {
    const k = classifyByGas(op.actualGasUsed);
    const cur = buckets.get(k) ?? { count: 0, totalCost: 0n };
    cur.count += 1;
    cur.totalCost += op.actualGasCost;
    buckets.set(k, cur);
  }
  return Array.from(buckets.entries()).map(([klass, v]) => ({ klass, ...v }));
}

export function topByVolume<T extends { chainId: SupportedChainId }>(
  events: T[],
  keyFn: (e: T) => string,
  amountFn: (e: T) => bigint,
  limit: number
): { key: string; chainId: SupportedChainId; count: number; total: bigint }[] {
  const map = new Map<string, { chainId: SupportedChainId; count: number; total: bigint }>();
  for (const e of events) {
    const k = keyFn(e);
    const cur = map.get(k) ?? { chainId: e.chainId, count: 0, total: 0n };
    cur.count += 1;
    cur.total += amountFn(e);
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .sort((a, b) => Number(b[1].total - a[1].total))
    .slice(0, limit)
    .map(([key, v]) => ({ key, ...v }));
}
