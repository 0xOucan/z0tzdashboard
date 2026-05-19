/**
 * /volume — Volume-bot monitoring page.
 *
 * Shows live progress of the stress-test bot: cycles attempted /
 * succeeded / failed, total USDC volume swept through real Z0tz
 * contracts, per-chain breakdown, recent activity table, latest
 * pool snapshot.
 *
 * Data comes from the `bot_*` tables in Turso (written by the
 * volumebot on the VPS). The page revalidates every 30s so a
 * casual reload reflects current state without manual refreshes.
 */
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ExplorerLink } from "@/components/ExplorerLink";
import { fmtUsdc, fmtEth, fmtUsd, fmtCompact, fmtDuration } from "@/lib/format";
import { CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { getEthPriceUsd } from "@/lib/prices";
import {
  getVolumeKpis,
  getOpsByChain,
  getRecentCycles,
  getThroughput,
  getLatestPoolSnapshot,
} from "@/lib/volume";
import {
  Activity,
  CheckCircle2,
  XCircle,
  DollarSign,
  Fuel,
  Zap,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export default async function VolumePage() {
  const [kpis, byChain, recent, throughput, pool, ethUsd] = await Promise.all([
    getVolumeKpis().catch(() => null),
    getOpsByChain().catch(() => []),
    getRecentCycles(25).catch(() => []),
    getThroughput().catch(() => []),
    getLatestPoolSnapshot().catch(() => []),
    getEthPriceUsd().catch(() => 2000),
  ]);

  if (!kpis) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Volume Bot"
          subtitle="Turso not configured on this dashboard deployment."
        />
        <div className="bg-bg-card border border-border rounded-lg p-6 text-sm text-text-muted">
          Set <code className="font-mono text-text">VOLUMEBOT_TURSO_DATABASE_URL</code> and{" "}
          <code className="font-mono text-text">VOLUMEBOT_TURSO_AUTH_TOKEN</code> on the dashboard's
          Vercel env so it can read the bot's <code className="font-mono">bot_*</code> tables.
          (Indexer's plain <code className="font-mono">TURSO_*</code> vars stay separate.)
        </div>
      </div>
    );
  }

  const successRate =
    kpis.totalCyclesAttempted === 0
      ? 0
      : (kpis.totalCyclesSucceeded / kpis.totalCyclesAttempted) * 100;
  const gasUsd = (Number(kpis.totalGasSpentEthWei) / 1e18) * ethUsd;
  const protocolFeesUsdcMicros = (kpis.totalVolumeUsdcMicros * 100n) / 10000n; // 1% sweeper fee estimate

  // Throughput chart values — width-normalize bars to the max.
  const maxCycles = throughput.reduce((a, b) => Math.max(a, b.cyclesCompleted), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Volume Bot"
        subtitle={
          kpis.activeRunId
            ? `Live run: ${kpis.activeRunId.slice(0, 8)}… — auto-refresh 30s`
            : `${kpis.totalRuns} run(s) recorded — no active run`
        }
        right={
          kpis.activeRunId && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-accent-green/10 text-accent-green border border-accent-green/30">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              live
            </span>
          )
        }
      />

      {/* ── Headline KPIs ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Cycles attempted"
          value={fmtCompact(kpis.totalCyclesAttempted)}
          sublabel={`${kpis.totalCyclesSucceeded.toLocaleString()} succeeded`}
          tone="blue"
          icon={<Activity className="w-4 h-4" />}
        />
        <KpiCard
          label="Success rate"
          value={`${successRate.toFixed(1)}%`}
          sublabel={`${kpis.totalCyclesFailed.toLocaleString()} failures`}
          tone={successRate > 95 ? "green" : successRate > 80 ? "amber" : "red"}
          icon={
            successRate > 95 ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )
          }
        />
        <KpiCard
          label="USDC volume swept"
          value={fmtUsdc(kpis.totalVolumeUsdcMicros, { compact: true })}
          sublabel={`through real Z0tz contracts`}
          tone="green"
          icon={<DollarSign className="w-4 h-4" />}
        />
        <KpiCard
          label="Relayer gas spent"
          value={fmtEth(kpis.totalGasSpentEthWei)}
          sublabel={fmtUsd(gasUsd)}
          tone="neutral"
          icon={<Fuel className="w-4 h-4" />}
        />
      </div>

      {/* ── Protocol fees earned ───────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent-amber" />
            Protocol revenue
          </h2>
          <span className="text-xs text-text-muted">
            est. from 1% sweeper fee on volume
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-text-muted">
              Estimated fees collected
            </div>
            <div className="text-2xl font-semibold tabular-nums text-accent-amber mt-1">
              {fmtUsdc(protocolFeesUsdcMicros, { compact: true })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-text-muted">
              Net margin (fees − relayer gas)
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-1">
              {fmtUsd(Number(protocolFeesUsdcMicros) / 1e6 - gasUsd)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-text-muted">
              Average per cycle
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-1">
              {kpis.totalCyclesSucceeded === 0
                ? "—"
                : fmtUsdc(protocolFeesUsdcMicros / BigInt(kpis.totalCyclesSucceeded), {
                    compact: false,
                  })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Per-chain breakdown ────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">By chain</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {byChain.map((c) => {
            const meta = CHAIN_META[c.chainId as SupportedChainId];
            if (!meta) return null;
            const successRate =
              c.successCount + c.failedCount === 0
                ? 0
                : (c.successCount / (c.successCount + c.failedCount)) * 100;
            return (
              <div
                key={c.chainId}
                className="border border-border rounded-md p-4 bg-bg"
              >
                <div className="flex items-center justify-between mb-3">
                  <span
                    className="text-sm font-medium"
                    style={{ color: meta.color }}
                  >
                    {meta.name}
                  </span>
                  <span className="text-xs text-text-muted">
                    {(c.successCount + c.failedCount).toLocaleString()} ops
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-text-muted">success</div>
                    <div className="tabular-nums">{successRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">avg latency</div>
                    <div className="tabular-nums">{fmtDuration(c.avgDurationMs / 1000)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">total gas</div>
                    <div className="tabular-nums">{fmtCompact(Number(c.totalGasUsed))}</div>
                  </div>
                </div>
              </div>
            );
          })}
          {byChain.length === 0 && (
            <div className="col-span-full text-sm text-text-muted">
              No on-chain ops recorded yet. Run the bot to populate this.
            </div>
          )}
        </div>
      </div>

      {/* ── Throughput chart ───────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Throughput — cycles per 5-min bucket</h2>
        {throughput.length === 0 ? (
          <div className="text-sm text-text-muted">No completed cycles yet.</div>
        ) : (
          <div className="flex items-end gap-0.5 h-24">
            {throughput.map((b, i) => (
              <div
                key={i}
                className="flex-1 bg-accent-blue/60 hover:bg-accent-blue rounded-t transition-colors min-h-[2px]"
                style={{
                  height: maxCycles === 0 ? "2px" : `${(b.cyclesCompleted / maxCycles) * 100}%`,
                }}
                title={`${new Date(b.bucketStart).toLocaleString()}: ${b.cyclesCompleted} cycles, ${fmtUsdc(b.volumeUsdcMicros)} USDC`}
              />
            ))}
          </div>
        )}
        <div className="flex justify-between text-xs text-text-muted mt-2">
          <span>{throughput[0] ? new Date(throughput[0].bucketStart).toLocaleString() : ""}</span>
          <span>
            peak: {maxCycles}/bucket
          </span>
          <span>{throughput[throughput.length - 1] ? new Date(throughput[throughput.length - 1].bucketStart).toLocaleString() : ""}</span>
        </div>
      </div>

      {/* ── Pool snapshot ──────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Source pool</h2>
        {pool.length === 0 ? (
          <div className="text-sm text-text-muted">No pool snapshots yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {pool.map((p) => {
              const meta = CHAIN_META[p.chainId as SupportedChainId];
              return (
                <div
                  key={p.chainId}
                  className="border border-border rounded-md p-4 bg-bg"
                >
                  <div className="text-xs uppercase tracking-wider text-text-muted">
                    {meta?.name ?? `chain ${p.chainId}`}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums mt-1">
                    {fmtUsdc(p.sourceUsdcMicros)}
                  </div>
                  <div className="text-xs text-text-muted mt-2">
                    {p.inFlightCycles} cycle(s) in flight ·{" "}
                    snapshot age{" "}
                    {fmtDuration((Date.now() - p.takenAt) / 1000)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recent cycles ──────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Recent cycles</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg/50 text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left px-6 py-3">#</th>
                <th className="text-left px-6 py-3">Flow</th>
                <th className="text-left px-6 py-3">Src → Dst</th>
                <th className="text-right px-6 py-3">Amount</th>
                <th className="text-left px-6 py-3">Status</th>
                <th className="text-right px-6 py-3">Duration</th>
                <th className="text-right px-6 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-text-muted py-8">
                    No cycles yet. Start the bot to see activity here.
                  </td>
                </tr>
              ) : (
                recent.map((c) => {
                  const src = CHAIN_META[c.srcChainId as SupportedChainId];
                  const dst = CHAIN_META[c.dstChainId as SupportedChainId];
                  const dur =
                    c.completedAt && c.completedAt > c.startedAt
                      ? fmtDuration((c.completedAt - c.startedAt) / 1000)
                      : "—";
                  return (
                    <tr key={c.cycleId} className="hover:bg-bg/30 transition-colors">
                      <td className="px-6 py-3 tabular-nums">{c.cycleIdx}</td>
                      <td className="px-6 py-3 text-text-muted">{c.flow}</td>
                      <td className="px-6 py-3">
                        <span style={{ color: src?.color }}>{src?.short ?? c.srcChainId}</span>
                        {c.srcChainId !== c.dstChainId && (
                          <>
                            <span className="text-text-muted mx-1">→</span>
                            <span style={{ color: dst?.color }}>{dst?.short ?? c.dstChainId}</span>
                          </>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {fmtUsdc(c.amountUsdcMicros)}
                      </td>
                      <td className="px-6 py-3">
                        {c.status === "success" ? (
                          <span className="inline-flex items-center gap-1 text-accent-green">
                            <CheckCircle2 className="w-3 h-3" /> success
                          </span>
                        ) : c.status === "failed" ? (
                          <span
                            className="inline-flex items-center gap-1 text-accent-red"
                            title={c.failureReason ?? ""}
                          >
                            <XCircle className="w-3 h-3" /> failed
                          </span>
                        ) : (
                          <span className="text-text-muted">{c.status}</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-text-muted">{dur}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-text-muted">
                        {new Date(c.startedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
