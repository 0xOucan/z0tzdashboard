import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod, PERIOD_DAYS } from "@/components/period";
import { ChainLegend } from "@/components/charts/Legend";
import { StackedBarChart } from "@/components/charts/StackedBarChart";
import { StackedAreaChart } from "@/components/charts/StackedAreaChart";
import { SingleLineChart } from "@/components/charts/LineChart";
import { Donut } from "@/components/charts/Donut";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { getPaymasterOps, getOperationalBalances } from "@/lib/events";
import { bucketDailyEth, filterByPeriod, sumGasCost, totalsByChain } from "@/lib/aggregate";
import { cumulative, bucketByOpClass, opClassColor, classifyByGas } from "@/lib/analytics";
import { BENCHMARK } from "@/lib/benchmarks";
import { SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/rpc";
import { fmtEth, fmtUsd, fmtFixed, fmtDuration } from "@/lib/format";
import { getEthPriceUsd } from "@/lib/prices";
import { Fuel, Wallet, AlertTriangle, CheckCircle2, TrendingUp, XCircle } from "lucide-react";
import { ADDRESSES } from "@/lib/addresses";
import { getAllRelayerCashFlows } from "@/lib/explorerApi";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const OP_CLASS_LABEL: Record<string, string> = {
  defiDeposit: "DeFi deposit (Tezcatli, ~1.7M gas)",
  defiWithdraw: "DeFi withdraw (Tezcatli, ~930K)",
  cashout: "Cashout / xc-cashout (~760K)",
  cashin: "Cash-in / sweep / unshield (~500-630K)",
  other: "Other (<450K)",
};

export default async function GasPage({ searchParams }: { searchParams: { period?: string } }) {
  const period = parsePeriod(searchParams.period);

  const [paymasterPerChain, balances, ethUsd, relayerFlows] = await Promise.all([
    Promise.all(SUPPORTED_CHAINS.map((c) => getPaymasterOps(c))),
    getOperationalBalances(),
    getEthPriceUsd(),
    getAllRelayerCashFlows(),
  ]);
  const explorerApiAvailable = relayerFlows.some((f) => f.available);
  const totalRelayerOut = relayerFlows.reduce(
    (a, f) => a + (f.available ? f.outflow : 0n),
    0n
  );
  const totalRelayerIn = relayerFlows.reduce(
    (a, f) => a + (f.available ? f.inflow : 0n),
    0n
  );
  const totalRelayerNet = totalRelayerOut - totalRelayerIn;
  const totalRelayerNetUsd = (Number(totalRelayerNet) / 1e18) * ethUsd;
  const totalRelayerOutUsd = (Number(totalRelayerOut) / 1e18) * ethUsd;
  const totalRelayerInUsd = (Number(totalRelayerIn) / 1e18) * ethUsd;
  const totalOutCount = relayerFlows.reduce((a, f) => a + f.outflowTxCount, 0);
  const totalInCount = relayerFlows.reduce((a, f) => a + f.inflowTxCount, 0);
  // totalTreasuryCostUsd is computed after `totalGasCost` is in scope below.

  const allOps = paymasterPerChain.flat();
  const ops = filterByPeriod(allOps, period);
  // Derived after `totalGasCost` is computed below.
  const totalGasCost = sumGasCost(ops);
  const totalTreasuryCostUsd = (Number(totalGasCost) / 1e18) * ethUsd + totalRelayerNetUsd;
  const successful = ops.filter((o) => o.success);
  const failed = ops.filter((o) => !o.success);
  const successRate = ops.length > 0 ? (successful.length / ops.length) * 100 : 100;

  const days = PERIOD_DAYS[period] ?? 7;
  const dailyChart = bucketDailyEth(ops, (e) => e.actualGasCost, days);
  const cumChart = cumulative(ops, (e) => (Number(e.actualGasCost) / 1e18) * ethUsd, days);
  const totalsByChainMap = totalsByChain(ops, (e) => e.actualGasCost);

  // 7-day rolling burn → per-chain runway
  const sevenDayAgoOps = filterByPeriod(allOps, "7d");
  const perChainBurnDaily: Record<SupportedChainId, number> = {} as Record<SupportedChainId, number>;
  for (const chainId of SUPPORTED_CHAINS) {
    const cost = sumGasCost(sevenDayAgoOps.filter((o) => o.chainId === chainId));
    perChainBurnDaily[chainId] = Number(cost) / 7;
  }
  const dailyBurnWei = Object.values(perChainBurnDaily).reduce((a, b) => a + b, 0);

  const totalPaymasterDeposit = balances.paymaster.reduce((acc, b) => acc + (b.paymasterDeposit ?? 0n), 0n);
  const totalRelayerBal = balances.relayer.reduce((acc, b) => acc + b.ethBalance, 0n);
  const combinedRuntime = totalPaymasterDeposit + totalRelayerBal;
  const runwayDays = dailyBurnWei > 0 ? Number(combinedRuntime) / dailyBurnWei : Number.POSITIVE_INFINITY;
  const runwayTone: "green" | "amber" | "red" =
    runwayDays > 30 ? "green" : runwayDays > 7 ? "amber" : "red";

  // Op-class breakdown
  const classBuckets = bucketByOpClass(ops);
  const classSlices = classBuckets
    .sort((a, b) => Number(b.totalCost - a.totalCost))
    .map((b) => ({
      label: OP_CLASS_LABEL[b.klass] ?? b.klass,
      value: (Number(b.totalCost) / 1e18) * ethUsd,
      color: opClassColor(b.klass),
      count: b.count,
    }));

  // Benchmark vs observed — for each benchmarked op-class, compute observed
  // avg gas (using ALL paymaster events, not just the current period) and
  // surface the drift percentage.
  const observedByClass = new Map<string, { totalGas: bigint; count: number }>();
  for (const op of allOps) {
    const k = classifyByGas(op.actualGasUsed);
    const cur = observedByClass.get(k) ?? { totalGas: 0n, count: 0 };
    cur.totalGas += op.actualGasUsed;
    cur.count += 1;
    observedByClass.set(k, cur);
  }
  const benchmarkRows = BENCHMARK.ops.map((b) => {
    const obs = observedByClass.get(b.klass);
    const observedAvg = obs && obs.count > 0 ? Number(obs.totalGas) / obs.count : null;
    const drift =
      observedAvg !== null ? ((observedAvg - b.avgGas) / b.avgGas) * 100 : null;
    return { ...b, observedAvg, observedCount: obs?.count ?? 0, drift };
  });

  // Avg gas cost per op trend (daily mean)
  const avgGasTrend = (() => {
    const now = Math.floor(Date.now() / 1000);
    const startDay = Math.floor((now - days * 86400) / 86400) * 86400;
    const buckets = new Map<number, { total: bigint; count: number }>();
    for (let d = 0; d <= days; d++) buckets.set(startDay + d * 86400, { total: 0n, count: 0 });
    for (const op of ops) {
      const dayStart = Math.floor(op.blockTimestamp / 86400) * 86400;
      const b = buckets.get(dayStart);
      if (!b) continue;
      b.total += op.actualGasCost;
      b.count += 1;
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, b]) => ({
        day: new Date(day * 1000).toISOString().slice(0, 10),
        value: b.count > 0 ? (Number(b.total / BigInt(b.count)) / 1e18) * ethUsd : 0,
      }));
  })();

  const avgGasCostUsd = ops.length > 0 ? (Number(totalGasCost) / ops.length / 1e18) * ethUsd : 0;
  const totalGasUsed = ops.reduce((acc, o) => acc + o.actualGasUsed, 0n);

  const recentFails = [...failed]
    .sort((a, b) => b.blockTimestamp - a.blockTimestamp)
    .slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Gas"
        subtitle="Paymaster sponsorships, gas spend by op class, success rate, and days-of-runway based on the trailing 7-day burn."
        right={<PeriodSelector active={period} />}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Paymaster gas"
          value={fmtUsd((Number(totalGasCost) / 1e18) * ethUsd)}
          sublabel={`${fmtEth(totalGasCost)} ETH · ${ops.length} ops · ${period}`}
          tone="red"
          icon={<Fuel className="w-4 h-4" />}
        />
        <KpiCard
          label="Relayer direct ETH"
          value={explorerApiAvailable ? fmtUsd(totalRelayerNetUsd) : "—"}
          sublabel={
            explorerApiAvailable
              ? `${fmtEth(totalRelayerNet)} ETH net · ${totalOutCount} top-ups`
              : "ETHERSCAN_API_KEY not set"
          }
          tone="red"
          icon={<Fuel className="w-4 h-4" />}
        />
        <KpiCard
          label="Total treasury cost"
          value={explorerApiAvailable ? fmtUsd(totalTreasuryCostUsd) : fmtUsd((Number(totalGasCost) / 1e18) * ethUsd)}
          sublabel={explorerApiAvailable ? "Paymaster + relayer direct" : "Paymaster only · top-ups missing"}
          tone="amber"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          label="Runway (7d burn)"
          value={Number.isFinite(runwayDays) ? fmtDuration(runwayDays * 86400) : "∞"}
          sublabel={
            dailyBurnWei > 0
              ? `${fmtFixed((dailyBurnWei / 1e18) * ethUsd, 2)} USD / day`
              : "no burn in 7d"
          }
          tone={runwayTone}
          icon={
            runwayTone === "green" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1 flex items-center gap-2">
            <Fuel className="w-4 h-4" />
            Paymaster sponsorships
          </h3>
          <p className="text-xs text-text-muted mb-4">
            EntryPoint UserOperationEvent.actualGasCost — gas the paymaster paid
            out of its EntryPoint deposit for sponsored ERC-4337 user ops.
          </p>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Avg gas / op</span>
              <span className="tabular-nums">{fmtUsd(avgGasCostUsd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Ops sponsored</span>
              <span className="tabular-nums">{ops.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Success rate</span>
              <span
                className={
                  "tabular-nums " +
                  (successRate >= 99
                    ? "text-accent-green"
                    : successRate >= 90
                    ? "text-accent-amber"
                    : "text-accent-red")
                }
              >
                {successRate.toFixed(1)}%
                <span className="text-text-muted ml-2 text-xs">
                  ({successful.length} ok · {failed.length} failed)
                </span>
              </span>
            </div>
            <div className="flex justify-between border-t border-border pt-3">
              <span className="text-text-muted font-medium">Total ETH burned</span>
              <span className="tabular-nums font-medium">{fmtEth(totalGasCost)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted font-medium">Total USD</span>
              <span className="tabular-nums font-medium text-accent-red">
                {fmtUsd((Number(totalGasCost) / 1e18) * ethUsd)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1 flex items-center gap-2">
            <Fuel className="w-4 h-4" />
            Relayer EOA — direct ETH outflows
          </h3>
          <p className="text-xs text-text-muted mb-4">
            Native ETH the relayer wallet (
            <ExplorerLink
              chainId={SUPPORTED_CHAINS[0]}
              value={ADDRESSES[SUPPORTED_CHAINS[0]].relayerWallet}
              type="address"
            />
            ) sent directly to stealths so they could sign their own txs (CCTP
            burns, manual unshield claims, dust returns).
          </p>
          {explorerApiAvailable ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Outflow (to stealths)</span>
                <span className="tabular-nums">
                  {fmtEth(totalRelayerOut)} ETH
                  <span className="text-text-muted ml-2 text-xs">
                    ({fmtUsd(totalRelayerOutUsd)})
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Inflow (dust returns)</span>
                <span className="tabular-nums text-accent-green">
                  +{fmtEth(totalRelayerIn)} ETH
                  <span className="text-text-muted ml-2 text-xs">
                    ({fmtUsd(totalRelayerInUsd)})
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Top-up txs / return txs</span>
                <span className="tabular-nums">
                  {totalOutCount} / {totalInCount}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-3">
                <span className="text-text-muted font-medium">Net ETH spent</span>
                <span className="tabular-nums font-medium">{fmtEth(totalRelayerNet)} ETH</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted font-medium">Net USD</span>
                <span className="tabular-nums font-medium text-accent-red">
                  {fmtUsd(totalRelayerNetUsd)}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-muted py-6 text-center">
              Set <code>ETHERSCAN_API_KEY</code> to capture relayer outflows.
              <br />
              One Etherscan V2 key covers all 3 chains.
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <h3 className="font-medium mb-1">Per-chain relayer direct outflows</h3>
        <p className="text-xs text-text-muted mb-4">
          Source-of-truth tx history from each block explorer. Net = outflow − dust returns.
        </p>
        {explorerApiAvailable ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Outflow ETH</th>
                <th className="pb-2 font-normal text-right">Dust returns ETH</th>
                <th className="pb-2 font-normal text-right">Net ETH</th>
                <th className="pb-2 font-normal text-right">Net USD</th>
                <th className="pb-2 font-normal text-right">Top-ups</th>
                <th className="pb-2 font-normal text-right">Returns</th>
              </tr>
            </thead>
            <tbody>
              {relayerFlows.map((f) => (
                <tr key={f.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={f.chainId} />
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {f.available ? fmtEth(f.outflow) : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums text-accent-green">
                    {f.available ? `+${fmtEth(f.inflow)}` : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums font-medium">
                    {f.available ? fmtEth(f.netSpent) : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {f.available
                      ? fmtUsd((Number(f.netSpent) / 1e18) * ethUsd)
                      : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {f.outflowTxCount}
                  </td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {f.inflowTxCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-sm text-text-muted py-6 text-center">
            ETHERSCAN_API_KEY not configured. Set it (free at{" "}
            <a
              href="https://etherscan.io/myapikey"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-accent"
            >
              etherscan.io/myapikey
            </a>
            ) and one key covers all three chains.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Daily spend</h3>
            <ChainLegend />
          </div>
          <p className="text-xs text-text-muted mb-3">ETH per day · per chain · ETH @ {fmtUsd(ethUsd)}</p>
          <StackedBarChart data={dailyChart} unitLabel="ETH" decimals={4} />
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Cumulative spend</h3>
          <p className="text-xs text-text-muted mb-3">Running total over the window</p>
          <SingleLineChart data={cumChart} color="#f87171" unitLabel="USD" decimals={2} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5 col-span-1">
          <h3 className="font-medium mb-1">Spend by op class</h3>
          <p className="text-xs text-text-muted mb-3">Classified by gas-used range</p>
          <Donut slices={classSlices} unitLabel=" USD" decimals={2} />
          <div className="mt-4 space-y-2">
            {classSlices.map((s) => (
              <div key={s.label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span>{s.label}</span>
                </div>
                <div className="text-right">
                  <span className="tabular-nums">{fmtUsd(s.value)}</span>
                  <span className="text-text-muted ml-2">{s.count}×</span>
                </div>
              </div>
            ))}
            {classSlices.length === 0 && (
              <div className="text-text-muted text-center py-4">No ops in window.</div>
            )}
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5 col-span-2">
          <h3 className="font-medium mb-1">Average gas cost per op</h3>
          <p className="text-xs text-text-muted mb-3">Daily mean across all chains, USD</p>
          <SingleLineChart data={avgGasTrend} color="#60a5fa" unitLabel="USD" decimals={3} height={260} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Per-chain breakdown</h3>
          <p className="text-xs text-text-muted mb-4">{period} window</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Spend USD</th>
                <th className="pb-2 font-normal text-right">Ops</th>
                <th className="pb-2 font-normal text-right">Avg / op</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_CHAINS.map((chainId) => {
                const wei = totalsByChainMap[chainId] ?? 0n;
                const opsCount = ops.filter((o) => o.chainId === chainId).length;
                const usd = (Number(wei) / 1e18) * ethUsd;
                const avg = opsCount > 0 ? usd / opsCount : 0;
                return (
                  <tr key={chainId} className="border-b border-border last:border-0">
                    <td className="py-3">
                      <ChainBadge chainId={chainId} />
                    </td>
                    <td className="py-3 text-right tabular-nums">{fmtUsd(usd)}</td>
                    <td className="py-3 text-right tabular-nums">{opsCount}</td>
                    <td className="py-3 text-right tabular-nums text-text-muted">{fmtUsd(avg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Operational wallets</h3>
          <p className="text-xs text-text-muted mb-4">Live balances · refill threshold ≈ 7-day burn</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Relayer EOA</th>
                <th className="pb-2 font-normal text-right">Paymaster</th>
                <th className="pb-2 font-normal text-right">Days left</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_CHAINS.map((chainId) => {
                const r = balances.relayer.find((b) => b.chainId === chainId);
                const p = balances.paymaster.find((b) => b.chainId === chainId);
                const rBal = r?.ethBalance ?? 0n;
                const pDep = p?.paymasterDeposit ?? 0n;
                const combined = rBal + pDep;
                const burn = perChainBurnDaily[chainId];
                const runway = burn > 0 ? Number(combined) / burn : Number.POSITIVE_INFINITY;
                const runwayColor =
                  runway > 30 ? "text-accent-green" : runway > 7 ? "text-accent-amber" : "text-accent-red";
                return (
                  <tr key={chainId} className="border-b border-border last:border-0">
                    <td className="py-3">
                      <ChainBadge chainId={chainId} />
                    </td>
                    <td className="py-3 text-right tabular-nums">{fmtEth(rBal)}</td>
                    <td className="py-3 text-right tabular-nums">{fmtEth(pDep)}</td>
                    <td className={"py-3 text-right tabular-nums font-medium " + runwayColor}>
                      {Number.isFinite(runway) ? fmtDuration(runway * 86400) : "∞"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-4 pt-3 border-t border-border text-[11px] text-text-muted flex items-center gap-1">
            Relayer wallet:
            <ExplorerLink
              chainId={SUPPORTED_CHAINS[0]}
              value={ADDRESSES[SUPPORTED_CHAINS[0]].relayerWallet}
              type="address"
            />
            · same address on all three chains
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <h3 className="font-medium mb-1">Benchmark vs observed</h3>
        <p className="text-xs text-text-muted mb-4">
          Reference gas numbers from the {BENCHMARK.runDate} V6.5 + Tezcatli super-run (
          <a
            href="https://github.com/0xOucan/Z0tz/blob/main/benchmarks/2026-05-02-v65-defi-super.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-accent"
          >
            benchmark
          </a>
          ) vs the dashboard's observed all-time averages per op-class. Drift &gt; ±10%
          on a stable op-type usually signals a contract regression or a chain-side gas
          model change.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Op (benchmark phase)</th>
              <th className="pb-2 font-normal text-right">Benchmark avg gas</th>
              <th className="pb-2 font-normal text-right">Observed avg gas</th>
              <th className="pb-2 font-normal text-right">Observed count</th>
              <th className="pb-2 font-normal text-right">Drift</th>
            </tr>
          </thead>
          <tbody>
            {benchmarkRows.map((row) => {
              const driftClass =
                row.drift === null
                  ? "text-text-subtle"
                  : Math.abs(row.drift) <= 10
                  ? "text-accent-green"
                  : Math.abs(row.drift) <= 25
                  ? "text-accent-amber"
                  : "text-accent-red";
              return (
                <tr key={row.klass} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <div className="font-medium">{row.label}</div>
                    <div className="text-[11px] text-text-muted">Phase {row.phases}</div>
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {(row.avgGas / 1000).toFixed(0)}K
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {row.observedAvg !== null
                      ? `${(row.observedAvg / 1000).toFixed(0)}K`
                      : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {row.observedCount}
                  </td>
                  <td className={"py-3 text-right tabular-nums font-medium " + driftClass}>
                    {row.drift !== null
                      ? `${row.drift > 0 ? "+" : ""}${row.drift.toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {recentFails.length > 0 && (
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-accent-red" />
            <h3 className="font-medium">Recent failed sponsorships</h3>
          </div>
          <p className="text-xs text-text-muted mb-3">
            Last 10 UserOps where the paymaster paid gas but execution reverted
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal">Sender</th>
                <th className="pb-2 font-normal text-right">Gas cost</th>
                <th className="pb-2 font-normal text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {recentFails.map((op, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2.5">
                    <ChainBadge chainId={op.chainId} />
                  </td>
                  <td className="py-2.5">
                    <ExplorerLink chainId={op.chainId} value={op.sender} type="address" />
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {fmtUsd((Number(op.actualGasCost) / 1e18) * ethUsd)}
                  </td>
                  <td className="py-2.5 text-right">
                    <ExplorerLink chainId={op.chainId} value={op.txHash} type="tx" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
