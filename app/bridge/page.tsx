import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodSelector } from "@/components/PeriodSelector";
import { parsePeriod } from "@/components/period";
import { ChainBadge } from "@/components/ChainBadge";
import { EventTable } from "@/components/EventTable";
import { getCctpBurns, getSweepEvents } from "@/lib/events";
import { filterByPeriod, sumUsdc, totalsByChain } from "@/lib/aggregate";
import { getAllRelayerCashFlows } from "@/lib/explorerApi";
import { SUPPORTED_CHAINS, CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { fmtUsdc, fmtCompact } from "@/lib/format";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ArrowLeftRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// CCTP destination domain → chainId mapping. Reference:
//   https://developers.circle.com/stablecoins/docs/cctp-domains
const DOMAIN_TO_CHAIN: Record<number, SupportedChainId | string> = {
  0: 11155111, // Eth
  3: 421614, // Arb
  6: 84532, // Base
};

function domainLabel(d: number): string {
  const c = DOMAIN_TO_CHAIN[d];
  if (typeof c === "number") return CHAIN_META[c as SupportedChainId].name;
  return `domain ${d}`;
}

export default async function BridgePage({ searchParams }: { searchParams: { period?: string } }) {
  const period = parsePeriod(searchParams.period);

  const [burnsPerChain, sweepsPerChain, relayerFlows] = await Promise.all([
    Promise.all(SUPPORTED_CHAINS.map((c) => getCctpBurns(c))),
    Promise.all(SUPPORTED_CHAINS.map((c) => getSweepEvents(c))),
    getAllRelayerCashFlows(),
  ]);

  // Z0tz-only filter — keep only CCTP burns whose depositor is a known
  // Z0tz stealth (appeared in PrivateSweep) or was funded by the relayer.
  // Anyone else is third-party CCTP traffic on the same USDC contract.
  const z0tzAddrs = new Set<string>();
  for (const s of sweepsPerChain.flat()) {
    z0tzAddrs.add((s.stealthAddress as string).toLowerCase());
  }
  for (const f of relayerFlows) {
    for (const d of f.destinations) z0tzAddrs.add(d.address.toLowerCase());
  }

  const allBurns = burnsPerChain.flat();
  const z0tzBurns = allBurns.filter((b) =>
    z0tzAddrs.has((b.depositor as string).toLowerCase())
  );
  const burns = filterByPeriod(z0tzBurns, period);
  const filteredOutCount = allBurns.length - z0tzBurns.length;

  const totalVolume = sumUsdc(burns);
  const totalsByChainMap = totalsByChain(burns, (e) => e.amount);

  // Source → destination flow
  const flowMap = new Map<string, { source: SupportedChainId; destDomain: number; count: number; volume: bigint }>();
  for (const b of burns) {
    const key = `${b.chainId}->${b.destinationDomain}`;
    const existing = flowMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.volume += b.amount;
    } else {
      flowMap.set(key, { source: b.chainId, destDomain: b.destinationDomain, count: 1, volume: b.amount });
    }
  }
  const flows = Array.from(flowMap.values()).sort((a, b) => Number(b.volume - a.volume));

  const recent = [...z0tzBurns]
    .sort((a, b) => b.blockTimestamp - a.blockTimestamp)
    .slice(0, 30);

  return (
    <div>
      <PageHeader
        title="Bridge"
        subtitle={`Circle CCTP V2 burns sourced from this chain, filtered to Z0tz flows (depositor is a known Z0tz stealth or relayer-funded address). ${filteredOutCount.toLocaleString()} third-party CCTP burns hidden.`}
        right={<PeriodSelector active={period} />}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="CCTP burn volume"
          value={fmtUsdc(totalVolume)}
          sublabel={`${burns.length} burns · ${period}`}
          tone="blue"
          icon={<ArrowLeftRight className="w-4 h-4" />}
        />
        <KpiCard label="Source chains" value={String(SUPPORTED_CHAINS.length)} sublabel="Base · Eth · Arb Sepolia" />
        <KpiCard label="Average burn" value={fmtUsdc(burns.length > 0 ? totalVolume / BigInt(burns.length) : 0n)} />
        <KpiCard label="Flows" value={String(flows.length)} sublabel="Distinct source→dest pairs" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-3">Source → destination flows</h3>
          <div className="space-y-3">
            {flows.length === 0 && (
              <div className="text-center text-sm text-text-muted py-8">No CCTP burns in window.</div>
            )}
            {flows.map((f, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChainBadge chainId={f.source} />
                  <span className="text-text-muted">→</span>
                  <span className="text-sm">{domainLabel(f.destDomain)}</span>
                </div>
                <div className="text-right">
                  <div className="font-medium tabular-nums">{fmtUsdc(f.volume)}</div>
                  <div className="text-[11px] text-text-muted">{f.count} burns</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-3">Volume by source</h3>
          <div className="space-y-3">
            {SUPPORTED_CHAINS.map((chainId) => {
              const total = totalsByChainMap[chainId] ?? 0n;
              return (
                <div key={chainId} className="flex items-center justify-between">
                  <ChainBadge chainId={chainId} />
                  <div className="text-right">
                    <div className="font-medium tabular-nums">{fmtUsdc(total)}</div>
                    <div className="text-[11px] text-text-muted">{fmtCompact(Number(total) / 1e6)} USDC</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1">Recent CCTP burns</h3>
        <p className="text-xs text-text-muted mb-3">Last 30 across all chains</p>
        <EventTable
          rows={recent}
          columns={[
            {
              header: "Depositor",
              cell: (r) => <ExplorerLink chainId={r.chainId} value={r.depositor} type="address" />,
            },
            {
              header: "Amount",
              align: "right",
              cell: (r) => fmtUsdc(r.amount),
            },
            {
              header: "→ Destination",
              cell: (r) => <span>{domainLabel(r.destinationDomain)}</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
