import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod, PERIOD_DAYS } from "@/components/period";
import { ChainBadge } from "@/components/ChainBadge";
import { ChainLegend } from "@/components/charts/Legend";
import { StackedAreaChart } from "@/components/charts/StackedAreaChart";
import { SingleLineChart } from "@/components/charts/LineChart";
import { Donut } from "@/components/charts/Donut";
import { HourHeatmap } from "@/components/charts/HourHeatmap";
import { ExplorerLink } from "@/components/ExplorerLink";
import { getSweepEvents, getLedgerCredits, getLedgerSpends, getPaymasterOps } from "@/lib/events";
import {
  bucketDaily,
  filterByPeriod,
  sumUsdc,
  totalsByChain,
} from "@/lib/aggregate";
import { cumulative, hourOfDay, topByVolume } from "@/lib/analytics";
import { getStealthAnnouncementCounts, getKycCounts } from "@/lib/tezcatli";
import { SUPPORTED_CHAINS, CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { fmtUsdc, fmtUsd, fmtCompact, fmtFixed } from "@/lib/format";
import { TrendingUp, DollarSign, Activity, Sigma } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const period = parsePeriod(searchParams.period);
  const days = PERIOD_DAYS[period] ?? 7;

  const [sweepsPerChain, creditsPerChain, spendsPerChain, opsPerChain, announcements, kycCounts] =
    await Promise.all([
      Promise.all(SUPPORTED_CHAINS.map((c) => getSweepEvents(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerCredits(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerSpends(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getPaymasterOps(c))),
      getStealthAnnouncementCounts(),
      getKycCounts(),
    ]);

  const totalAnnouncements = announcements.reduce((a, x) => a + x.count, 0);
  const totalKyc = kycCounts.reduce((a, x) => a + x.netCount, 0);

  const sweepsAll = sweepsPerChain.flat();
  const creditsAll = creditsPerChain.flat();
  const spendsAll = spendsPerChain.flat();
  const opsAll = opsPerChain.flat();

  const sweeps = filterByPeriod(sweepsAll, period);
  const credits = filterByPeriod(creditsAll, period);
  const spends = filterByPeriod(spendsAll, period);
  const ops = filterByPeriod(opsAll, period);
  const cashouts = spends.filter((s) => s.action === "Cashout");

  // KPIs
  const totalIn = sumUsdc(credits);
  const totalFeesUsdc = sweeps.reduce((acc, s) => acc + s.fee, 0n);
  const avgSweep = sweeps.length > 0 ? sumUsdc(sweeps) / BigInt(sweeps.length) : 0n;
  const totalUsersActive = new Set(sweeps.map((s) => s.stealthAddress)).size;

  // Cumulative curves
  const cumIn = cumulative(credits, (e) => Number(e.netAmount) / 1e6, days);
  const cumOut = cumulative(cashouts, () => 1, days);
  const cumFees = cumulative(sweeps, (e) => Number(e.fee) / 1e6, days);

  // Daily inflow stacked area
  const inflowChart = bucketDaily(credits, (e) => e.netAmount, days);

  // Avg sweep size daily
  const avgSweepTrend = (() => {
    const now = Math.floor(Date.now() / 1000);
    const startDay = Math.floor((now - days * 86400) / 86400) * 86400;
    const buckets = new Map<number, { total: bigint; count: number }>();
    for (let d = 0; d <= days; d++) buckets.set(startDay + d * 86400, { total: 0n, count: 0 });
    for (const s of sweeps) {
      const dayStart = Math.floor(s.blockTimestamp / 86400) * 86400;
      const b = buckets.get(dayStart);
      if (!b) continue;
      b.total += s.shieldedAmount;
      b.count += 1;
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, b]) => ({
        day: new Date(day * 1000).toISOString().slice(0, 10),
        value: b.count > 0 ? Number(b.total / BigInt(b.count)) / 1e6 : 0,
      }));
  })();

  // Hour-of-day heatmaps
  const inflowHours = hourOfDay(credits);
  const outflowHours = hourOfDay(cashouts);

  // Market share per chain (inflow USD)
  const totalsIn = totalsByChain(credits, (e) => e.netAmount);
  const marketShare = SUPPORTED_CHAINS.map((chainId) => ({
    label: CHAIN_META[chainId].name,
    value: Number(totalsIn[chainId] ?? 0n) / 1e6,
    color: CHAIN_META[chainId].color,
  }));

  // Top stealth addresses by sweep volume (anonymized → just shortAddress)
  const topStealths = topByVolume(
    sweepsAll,
    (e) => `${e.chainId}-${e.stealthAddress}`,
    (e) => e.shieldedAmount,
    10
  ).map((r) => {
    const [, addr] = r.key.split("-");
    return { ...r, addr: addr as `0x${string}` };
  });

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Cumulative curves, fee revenue, time-of-day patterns, per-chain market share, top depositors."
        right={<PeriodSelector active={period} />}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-3">
            Stealth payments (ERC-5564)
          </div>
          <div className="text-2xl font-semibold mb-2 tabular-nums">{totalAnnouncements}</div>
          <div className="space-y-1 text-xs text-text-muted">
            {announcements.map((a) => (
              <div key={a.chainId} className="flex justify-between">
                <span>
                  <ChainBadge chainId={a.chainId} />
                </span>
                <span className="tabular-nums">{a.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-3">
            KYC attestations (net)
          </div>
          <div className="text-2xl font-semibold mb-2 tabular-nums">{totalKyc}</div>
          <div className="space-y-1 text-xs text-text-muted">
            {kycCounts.map((k) => (
              <div key={k.chainId} className="flex justify-between">
                <span>
                  <ChainBadge chainId={k.chainId} />
                </span>
                <span className="tabular-nums">{k.netCount}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-3">Period summary</div>
          <div className="text-2xl font-semibold mb-2 tabular-nums">{credits.length + cashouts.length}</div>
          <div className="text-xs text-text-muted">
            {credits.length} credits · {cashouts.length} cashouts · {sweeps.length} sweeps in {period}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Sweeper fee revenue"
          value={fmtUsdc(totalFeesUsdc)}
          sublabel={`${sweeps.length} sweeps · 1% fee · ${period}`}
          tone="green"
          icon={<DollarSign className="w-4 h-4" />}
        />
        <KpiCard
          label="Average sweep size"
          value={fmtUsdc(avgSweep)}
          sublabel="Per sweep · USDC"
          icon={<Sigma className="w-4 h-4" />}
        />
        <KpiCard
          label="Unique stealths"
          value={String(totalUsersActive)}
          sublabel={`Active in ${period}`}
          tone="blue"
          icon={<Activity className="w-4 h-4" />}
        />
        <KpiCard
          label="Net flow"
          value={fmtUsd(Number(totalIn) / 1e6)}
          sublabel={`${credits.length} credits · ${cashouts.length} cashouts`}
          tone="amber"
          icon={<TrendingUp className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Cumulative cash-in (USDC)</h3>
          <p className="text-xs text-text-muted mb-3">Running total over the selected window</p>
          <SingleLineChart data={cumIn} color="#34d399" unitLabel="USDC" decimals={0} />
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Cumulative sweeper fees</h3>
          <p className="text-xs text-text-muted mb-3">Revenue accrued to treasury · 1% of every sweep</p>
          <SingleLineChart data={cumFees} color="#fbbf24" unitLabel="USDC" decimals={2} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Daily inflow (stacked)</h3>
            <ChainLegend />
          </div>
          <p className="text-xs text-text-muted mb-3">Per-chain area</p>
          <StackedAreaChart data={inflowChart} unitLabel="USDC" />
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Average sweep size trend</h3>
          <p className="text-xs text-text-muted mb-3">Daily mean across all chains</p>
          <SingleLineChart data={avgSweepTrend} color="#60a5fa" unitLabel="USDC" decimals={2} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Market share (inflow USD)</h3>
          <p className="text-xs text-text-muted mb-3">Distribution across chains</p>
          <Donut slices={marketShare} unitLabel=" USDC" decimals={2} />
          <div className="mt-3 space-y-1.5">
            {marketShare.map((s) => {
              const total = marketShare.reduce((acc, m) => acc + m.value, 0);
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span>{s.label}</span>
                  </div>
                  <div>
                    <span className="tabular-nums">{fmtFixed(s.value, 2)}</span>
                    <span className="text-text-muted ml-2">{fmtFixed(pct, 1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5 col-span-2">
          <h3 className="font-medium mb-1">Hour-of-day activity (UTC)</h3>
          <p className="text-xs text-text-muted mb-3">When do cash-ins happen vs cash-outs?</p>
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-text-muted mb-2">Cash-in (credits)</div>
            <HourHeatmap data={inflowHours} label="cash-ins" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-text-muted mb-2">Cash-out (Cashout spends)</div>
            <HourHeatmap data={outflowHours} label="cash-outs" />
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1">Top stealth addresses by inflow</h3>
        <p className="text-xs text-text-muted mb-3">
          Ranked by total swept USDC · all-time · click to verify on the explorer
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal w-12">#</th>
              <th className="pb-2 font-normal">Chain</th>
              <th className="pb-2 font-normal">Stealth address</th>
              <th className="pb-2 font-normal text-right">Total swept</th>
              <th className="pb-2 font-normal text-right">Sweeps</th>
            </tr>
          </thead>
          <tbody>
            {topStealths.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-sm text-text-muted">
                  No sweeps yet on any chain.
                </td>
              </tr>
            )}
            {topStealths.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2.5 text-text-muted">{i + 1}</td>
                <td className="py-2.5">
                  <ChainBadge chainId={row.chainId} />
                </td>
                <td className="py-2.5">
                  <ExplorerLink chainId={row.chainId} value={row.addr} type="address" />
                </td>
                <td className="py-2.5 text-right tabular-nums">{fmtUsdc(row.total)}</td>
                <td className="py-2.5 text-right tabular-nums text-text-muted">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
