import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ChainBadge } from "@/components/ChainBadge";
import { ChainLegend } from "@/components/charts/Legend";
import { StackedBarChart } from "@/components/charts/StackedBarChart";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod } from "@/components/period";
import {
  getSweepEvents,
  getLedgerCredits,
  getLedgerSpends,
  getPaymasterOps,
  getOperationalBalances,
} from "@/lib/events";
import {
  bucketDaily,
  filterByPeriod,
  sumGasCost,
  sumUsdc,
  totalsByChain,
} from "@/lib/aggregate";
import { SUPPORTED_CHAINS, CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { fmtUsdc, fmtEth, fmtUsd, fmtCompact } from "@/lib/format";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ADDRESSES } from "@/lib/addresses";
import { getEthPriceUsd } from "@/lib/prices";
import { ArrowDownToLine, ArrowUpFromLine, Fuel, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const PERIOD_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, all: 30 };

export default async function Page({ searchParams }: { searchParams: { period?: string } }) {
  const period = parsePeriod(searchParams.period);

  const [allSweepsByChain, allCreditsByChain, allSpendsByChain, allPaymasterByChain, balances, ethUsd] =
    await Promise.all([
      Promise.all(SUPPORTED_CHAINS.map((c) => getSweepEvents(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerCredits(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerSpends(c))),
      Promise.all(SUPPORTED_CHAINS.map((c) => getPaymasterOps(c))),
      getOperationalBalances(),
      getEthPriceUsd(),
    ]);

  const sweeps = allSweepsByChain.flat();
  const credits = allCreditsByChain.flat();
  const spends = allSpendsByChain.flat();
  const paymasterOps = allPaymasterByChain.flat();

  const inPeriodCredits = filterByPeriod(credits, period);
  const inPeriodSpends = filterByPeriod(spends, period);
  const inPeriodPaymaster = filterByPeriod(paymasterOps, period);

  const totalIn = sumUsdc(inPeriodCredits);
  const cashoutSpends = inPeriodSpends.filter((s) => s.action === "Cashout");
  const totalOutCount = cashoutSpends.length;
  const totalGasCost = sumGasCost(inPeriodPaymaster);
  const totalGasUsd = (Number(totalGasCost) / 1e18) * ethUsd;

  const totalPaymasterDeposit = balances.paymaster.reduce(
    (acc, b) => acc + (b.paymasterDeposit ?? 0n),
    0n
  );
  const totalRelayerBal = balances.relayer.reduce((acc, b) => acc + b.ethBalance, 0n);

  const cashinChart = bucketDaily(
    inPeriodCredits,
    (e) => e.netAmount,
    PERIOD_DAYS[period] ?? 7
  );

  const totalsIn = totalsByChain(inPeriodCredits, (e) => e.netAmount);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Z0tz relayer + paymaster economy across three testnets."
        right={<PeriodSelector active={period} />}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Cashed in"
          value={fmtUsd(Number(totalIn) / 1e6, { compact: false })}
          sublabel={`${inPeriodCredits.length} ledger credits · ${period}`}
          tone="green"
          icon={<ArrowDownToLine className="w-4 h-4" />}
        />
        <KpiCard
          label="Cashed out"
          value={`${totalOutCount}`}
          sublabel={`Cashout actions · ${period}`}
          tone="amber"
          icon={<ArrowUpFromLine className="w-4 h-4" />}
        />
        <KpiCard
          label="Paymaster gas spent"
          value={fmtUsd(totalGasUsd, { compact: false })}
          sublabel={`${fmtEth(totalGasCost)} ETH · ${period}`}
          tone="red"
          icon={<Fuel className="w-4 h-4" />}
        />
        <KpiCard
          label="Relayer + paymaster deposit"
          value={fmtUsd((Number(totalRelayerBal + totalPaymasterDeposit) / 1e18) * ethUsd)}
          sublabel={`${fmtEth(totalRelayerBal + totalPaymasterDeposit)} ETH on hand`}
          tone="blue"
          icon={<Wallet className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Cash-in volume</h3>
            <ChainLegend />
          </div>
          <p className="text-xs text-text-muted mb-3">Daily USDC credited to ledger · per chain</p>
          <StackedBarChart data={cashinChart} unitLabel="USDC" decimals={0} />
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1">Cash-in by chain</h3>
          <p className="text-xs text-text-muted mb-3">Totals for the selected period</p>
          <div className="space-y-3">
            {SUPPORTED_CHAINS.map((chainId) => {
              const total = totalsIn[chainId] ?? 0n;
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
        <h3 className="font-medium mb-1">Operational wallets</h3>
        <p className="text-xs text-text-muted mb-4">
          Relayer EOA balance + paymaster EntryPoint deposit per chain. ETH @ {fmtUsd(ethUsd)}.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Chain</th>
              <th className="pb-2 font-normal text-right">Relayer EOA</th>
              <th className="pb-2 font-normal text-right">Paymaster deposit</th>
              <th className="pb-2 font-normal text-right">Combined</th>
              <th className="pb-2 font-normal text-right">≈ USD</th>
            </tr>
          </thead>
          <tbody>
            {SUPPORTED_CHAINS.map((chainId) => {
              const r = balances.relayer.find((b) => b.chainId === chainId);
              const p = balances.paymaster.find((b) => b.chainId === chainId);
              const rBal = r?.ethBalance ?? 0n;
              const pDep = p?.paymasterDeposit ?? 0n;
              const combined = rBal + pDep;
              const usd = (Number(combined) / 1e18) * ethUsd;
              const addrs = ADDRESSES[chainId];
              return (
                <tr key={chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={chainId} />
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    <div className="flex items-center justify-end gap-2">
                      <span>{fmtEth(rBal)}</span>
                      <ExplorerLink
                        chainId={chainId}
                        value={addrs.relayerWallet}
                        type="address"
                        label=""
                      />
                    </div>
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    <div className="flex items-center justify-end gap-2">
                      <span>{fmtEth(pDep)}</span>
                      {addrs.paymaster !== "0x0000000000000000000000000000000000000000" && (
                        <ExplorerLink chainId={chainId} value={addrs.paymaster} type="address" label="" />
                      )}
                    </div>
                  </td>
                  <td className="py-3 text-right tabular-nums">{fmtEth(combined)}</td>
                  <td className="py-3 text-right tabular-nums text-text-muted">{fmtUsd(usd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
