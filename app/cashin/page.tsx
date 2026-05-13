import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod } from "@/components/period";
import { ChainLegend } from "@/components/charts/Legend";
import { StackedBarChart } from "@/components/charts/StackedBarChart";
import { EventTable } from "@/components/EventTable";
import { getSweepEvents, getLedgerCredits } from "@/lib/events";
import { bucketDaily, filterByPeriod, sumUsdc, totalsByChain } from "@/lib/aggregate";
import { SUPPORTED_CHAINS, CHAIN_META } from "@/lib/rpc";
import { fmtUsdc, fmtCompact } from "@/lib/format";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ArrowDownToLine } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const PERIOD_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, all: 30 };

export default async function CashInPage({ searchParams }: { searchParams: { period?: string } }) {
  const period = parsePeriod(searchParams.period);

  const [sweepsPerChain, creditsPerChain] = await Promise.all([
    Promise.all(SUPPORTED_CHAINS.map((c) => getSweepEvents(c))),
    Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerCredits(c))),
  ]);

  const sweeps = filterByPeriod(sweepsPerChain.flat(), period);
  const credits = filterByPeriod(creditsPerChain.flat(), period);

  const totalSwept = sumUsdc(sweeps);
  const totalCredited = sumUsdc(credits);
  const totalFees = sweeps.reduce((acc, s) => acc + s.fee, 0n);
  const avgSweep = sweeps.length > 0 ? totalSwept / BigInt(sweeps.length) : 0n;

  const chart = bucketDaily(credits, (e) => e.netAmount, PERIOD_DAYS[period] ?? 7);
  const totalsByChainMap = totalsByChain(credits, (e) => e.netAmount);

  const recentSweeps = [...sweepsPerChain.flat()]
    .sort((a, b) => b.blockTimestamp - a.blockTimestamp)
    .slice(0, 30);

  return (
    <div>
      <PageHeader
        title="Cash In"
        subtitle="Sweeper → vault → encrypted ledger. Inbound USDC volume by chain."
        right={<PeriodSelector active={period} />}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total swept"
          value={fmtUsdc(totalSwept)}
          sublabel={`${sweeps.length} sweeps · ${period}`}
          tone="green"
          icon={<ArrowDownToLine className="w-4 h-4" />}
        />
        <KpiCard
          label="Ledger credited"
          value={fmtUsdc(totalCredited)}
          sublabel={`${credits.length} ledger credits`}
          tone="green"
        />
        <KpiCard
          label="Sweeper fees"
          value={fmtUsdc(totalFees)}
          sublabel="1% fee per sweep"
          tone="blue"
        />
        <KpiCard
          label="Average sweep"
          value={fmtUsdc(avgSweep)}
          sublabel="Per sweep"
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Daily inflow by chain</h3>
            <ChainLegend />
          </div>
          <p className="text-xs text-text-muted mb-3">USDC credited to ledger per day</p>
          <StackedBarChart data={chart} unitLabel="USDC" decimals={0} />
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-3">Total by chain</h3>
          <div className="space-y-3">
            {SUPPORTED_CHAINS.map((chainId) => {
              const total = totalsByChainMap[chainId] ?? 0n;
              const usd = Number(total) / 1e6;
              return (
                <div key={chainId} className="flex items-center justify-between">
                  <ChainBadge chainId={chainId} />
                  <div className="text-right">
                    <div className="font-medium tabular-nums">{fmtUsdc(total)}</div>
                    <div className="text-[11px] text-text-muted">{fmtCompact(usd)} USDC</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1">Recent sweeps</h3>
        <p className="text-xs text-text-muted mb-3">Last 30 sweeper events across all chains</p>
        <EventTable
          rows={recentSweeps}
          columns={[
            {
              header: "Stealth",
              cell: (r) => <ExplorerLink chainId={r.chainId} value={r.stealthAddress} type="address" />,
            },
            {
              header: "Amount",
              align: "right",
              cell: (r) => fmtUsdc(r.shieldedAmount),
            },
            {
              header: "Fee",
              align: "right",
              cell: (r) => <span className="text-text-muted">{fmtUsdc(r.fee)}</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
