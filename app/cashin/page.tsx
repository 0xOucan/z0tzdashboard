import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod, PERIOD_DAYS } from "@/components/period";
import { ChainLegend } from "@/components/charts/Legend";
import { StackedBarChart } from "@/components/charts/StackedBarChart";
import { EventTable } from "@/components/EventTable";
import { getSweepEvents, getLedgerCredits } from "@/lib/events";
import { bucketDaily, filterByPeriod, sumUsdc, totalsByChain } from "@/lib/aggregate";
import { SUPPORTED_CHAINS, CHAIN_META } from "@/lib/rpc";
import { fmtUsdc, fmtCompact, fmtUsd, fmtEth } from "@/lib/format";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ArrowDownToLine } from "lucide-react";
import { getPaymasterOps } from "@/lib/events";
import { sumGasCost } from "@/lib/aggregate";
import { computeTreasury } from "@/lib/treasury";
import { getEthPriceUsd } from "@/lib/prices";
import { getAllRelayerCashFlows } from "@/lib/explorerApi";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function CashInPage({ searchParams }: { searchParams: { period?: string } }) {
  const period = parsePeriod(searchParams.period);

  const [sweepsPerChain, creditsPerChain, paymasterPerChain, ethUsd, relayerFlows] =
    await Promise.all([
      Promise.all(SUPPORTED_CHAINS.map((c) => getSweepEvents(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerCredits(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getPaymasterOps(c))),
      getEthPriceUsd(),
      getAllRelayerCashFlows(),
    ]);
  const explorerApiAvailable = relayerFlows.some((f) => f.available);
  const relayerNetDirectSpendWei = relayerFlows.reduce(
    (acc, f) => acc + (f.available ? f.stealthNetCost : 0n),
    0n
  );

  const sweeps = filterByPeriod(sweepsPerChain.flat(), period);
  const credits = filterByPeriod(creditsPerChain.flat(), period);
  const periodOps = filterByPeriod(paymasterPerChain.flat(), period);

  const totalSwept = sumUsdc(sweeps);
  const totalCredited = sumUsdc(credits);
  const totalFees = sweeps.reduce((acc, s) => acc + s.fee, 0n);
  const avgSweep = sweeps.length > 0 ? totalSwept / BigInt(sweeps.length) : 0n;

  const gasSpentWei = sumGasCost(periodOps);
  const treasury = computeTreasury({
    sweeperFeesUsdc: totalFees,
    gasSpentWei,
    relayerDirectSpendWei: relayerNetDirectSpendWei,
    cashinVolumeUsdc: totalSwept,
    ethUsd,
  });

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

      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-medium">Break-even — fees vs gas</h3>
          <span
            className={
              "text-xs px-2 py-0.5 rounded font-medium uppercase tracking-wider " +
              (treasury.status === "profit"
                ? "bg-accent-green/20 text-accent-green"
                : treasury.status === "breakeven"
                ? "bg-accent-amber/20 text-accent-amber"
                : "bg-accent-red/20 text-accent-red")
            }
          >
            {treasury.status === "profit"
              ? "Profitable"
              : treasury.status === "breakeven"
              ? "Near break-even"
              : "Operating at loss"}
          </span>
        </div>
        <p className="text-xs text-text-muted mb-4">
          Sweeper fee revenue collected on the {period} window vs gas burned to
          sponsor user ops in the same window. Each 1% sweeper fee on a $X cash-in
          needs to cover ~$X × current avg-op-cost ÷ avg-cash-in-size in gas.
        </p>
        <div className="grid grid-cols-5 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Sweeper revenue
            </div>
            <div className="text-xl font-semibold tabular-nums text-accent-green">
              {fmtUsd(treasury.sweeperFeesUsd)}
            </div>
            <div className="text-[11px] text-text-muted">
              {sweeps.length} sweeps · {fmtUsd(treasury.cashinVolumeUsd)} volume
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Paymaster gas
            </div>
            <div className="text-xl font-semibold tabular-nums text-accent-red">
              −{fmtUsd(treasury.paymasterGasUsd)}
            </div>
            <div className="text-[11px] text-text-muted">
              {fmtEth(gasSpentWei)} ETH · {periodOps.length} ops
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Stealth top-ups
            </div>
            <div className="text-xl font-semibold tabular-nums text-accent-red">
              {explorerApiAvailable ? `−${fmtUsd(treasury.relayerDirectSpendUsd)}` : "—"}
            </div>
            <div className="text-[11px] text-text-muted">
              {explorerApiAvailable
                ? `${fmtEth(relayerNetDirectSpendWei)} ETH net`
                : "Explorer API key not set"}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Net
            </div>
            <div
              className={
                "text-xl font-semibold tabular-nums " +
                (treasury.netUsd >= 0 ? "text-accent-green" : "text-accent-red")
              }
            >
              {treasury.netUsd >= 0 ? "+" : ""}
              {fmtUsd(treasury.netUsd)}
            </div>
            <div className="text-[11px] text-text-muted">
              Coverage: {treasury.coverage === Number.POSITIVE_INFINITY ? "∞" : `${(treasury.coverage * 100).toFixed(0)}%`}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              {treasury.netUsd >= 0 ? "Cushion" : "Cash-in gap"}
            </div>
            <div className="text-xl font-semibold tabular-nums text-accent-amber">
              {treasury.netUsd >= 0
                ? fmtUsd(treasury.netUsd)
                : fmtUsd(treasury.breakEvenAdditionalCashinUsd)}
            </div>
            <div className="text-[11px] text-text-muted">
              {treasury.netUsd >= 0
                ? "Above break-even"
                : "more cash-in volume needed"}
            </div>
          </div>
        </div>
        {!explorerApiAvailable && (
          <div className="mt-3 px-3 py-2 rounded-md bg-accent-amber/10 border border-accent-amber/30 text-[11px] text-accent-amber">
            ⚠ Stealth-funding outflows not counted — set ETHERSCAN_API_KEY /
            BASESCAN_API_KEY / ARBISCAN_API_KEY (free) to capture native ETH
            transfers from the relayer to stealth EOAs.
          </div>
        )}
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
