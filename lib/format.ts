import { formatUnits } from "viem";

const USDC_DECIMALS = 6;
const ETH_DECIMALS = 18;

export function fmtUsdc(amount: bigint, opts: { compact?: boolean } = {}): string {
  const n = Number(formatUnits(amount, USDC_DECIMALS));
  return opts.compact ? fmtCompact(n) : fmtFixed(n, 2);
}

export function fmtEth(wei: bigint, opts: { decimals?: number } = {}): string {
  const n = Number(formatUnits(wei, ETH_DECIMALS));
  return fmtFixed(n, opts.decimals ?? 4);
}

export function fmtUsd(usd: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) return "$" + fmtCompact(usd);
  return "$" + fmtFixed(usd, 2);
}

export function fmtFixed(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n.toFixed(2);
}

export function shortAddress(addr: string, chars: number = 4): string {
  if (!addr.startsWith("0x") || addr.length < 10) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
