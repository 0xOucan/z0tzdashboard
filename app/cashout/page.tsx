import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod, PERIOD_DAYS } from "@/components/period";
import { ChainLegend } from "@/components/charts/Legend";
import { StackedBarChart } from "@/components/charts/StackedBarChart";
import { EventTable } from "@/components/EventTable";
import { getLedgerSpends } from "@/lib/events";
import { filterByPeriod } from "@/lib/aggregate";
import { SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/rpc";
import { shortAddress } from "@/lib/format";
import { ChainBadge } from "@/components/ChainBadge";
import { ArrowUpFromLine } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function CashOutPage({ searchParams }: { searchParams: { period?: string } }) {
  const period = parsePeriod(searchParams.period);

  const spendsPerChain = await Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerSpends(c)));
  const allSpends = spendsPerChain.flat();
  const periodSpends = filterByPeriod(allSpends, period);
  const cashouts = periodSpends.filter((s) => s.action === "Cashout");
  const internal = periodSpends.filter((s) => s.action === "Internal");

  const chartData = (() => {
    const days = PERIOD_DAYS[period] ?? 7;
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
    for (const e of cashouts) {
      const dayStart = Math.floor(e.blockTimestamp / 86400) * 86400;
      const bucket = buckets.get(dayStart);
      if (!bucket) continue;
      bucket[e.chainId] = (bucket[e.chainId] ?? 0) + 1;
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, chainBuckets]) => ({
        day: new Date(day * 1000).toISOString().slice(0, 10),
        chainBuckets,
      }));
  })();

  const byChain = SUPPORTED_CHAINS.map((chainId) => ({
    chainId,
    cashouts: cashouts.filter((s) => s.chainId === chainId).length,
    internal: internal.filter((s) => s.chainId === chainId).length,
  }));

  const recent = [...allSpends]
    .sort((a, b) => b.blockTimestamp - a.blockTimestamp)
    .slice(0, 30);

  return (
    <div>
      <PageHeader
        title="Cash Out"
        subtitle="Ledger spend → ephemeral stealth → external target. Encrypted amounts on chain; counts here."
        right={<PeriodSelector active={period} />}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Cashouts"
          value={String(cashouts.length)}
          sublabel={`Spent → external · ${period}`}
          tone="amber"
          icon={<ArrowUpFromLine className="w-4 h-4" />}
        />
        <KpiCard
          label="Internal spends"
          value={String(internal.length)}
          sublabel="Ledger A → ledger B"
        />
        <KpiCard
          label="Total spends"
          value={String(periodSpends.length)}
          sublabel="All ledger Spent events"
        />
        <KpiCard
          label="Cashout ratio"
          value={periodSpends.length > 0 ? `${Math.round((cashouts.length / periodSpends.length) * 100)}%` : "—"}
          sublabel="Cashouts ÷ all spends"
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Daily cashouts by chain</h3>
            <ChainLegend />
          </div>
          <p className="text-xs text-text-muted mb-3">
            Cashout action count per day. Amounts are FHE-encrypted on chain.
          </p>
          <StackedBarChart data={chartData} unitLabel="cashouts" decimals={0} />
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-3">By chain</h3>
          <div className="space-y-3">
            {byChain.map((row) => (
              <div key={row.chainId} className="flex items-center justify-between">
                <ChainBadge chainId={row.chainId} />
                <div className="text-right">
                  <div className="font-medium tabular-nums">{row.cashouts}</div>
                  <div className="text-[11px] text-text-muted">{row.internal} internal</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1">Recent spends</h3>
        <p className="text-xs text-text-muted mb-3">Last 30 ledger events across all chains</p>
        <EventTable
          rows={recent}
          columns={[
            {
              header: "Action",
              cell: (r) => (
                <span
                  className={
                    r.action === "Cashout"
                      ? "text-accent-amber font-medium"
                      : "text-text-muted"
                  }
                >
                  {r.action}
                </span>
              ),
            },
            {
              header: "Old ID",
              cell: (r) => <span className="font-mono text-xs">{shortAddress(r.oldId)}</span>,
            },
            {
              header: "New ID",
              cell: (r) => (
                <span className="font-mono text-xs">
                  {r.newId === "0x0000000000000000000000000000000000000000000000000000000000000000"
                    ? "(no rotation)"
                    : shortAddress(r.newId)}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
