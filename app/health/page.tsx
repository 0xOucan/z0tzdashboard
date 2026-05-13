import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import {
  getOperationalBalances,
  getSweepEvents,
  getLedgerCredits,
  getLedgerSpends,
  getPaymasterOps,
  getCctpBurns,
} from "@/lib/events";
import { getChainHealth } from "@/lib/health";
import {
  getComplianceState,
  getKycCounts,
  getOfacCounts,
  getDepositorCounts,
} from "@/lib/tezcatli";
import {
  scanGovernance,
  openRecoveries,
  legacySweeperState,
} from "@/lib/governance";
import { ADDRESSES } from "@/lib/addresses";
import { SUPPORTED_CHAINS, type SupportedChainId, CHAIN_META } from "@/lib/rpc";
import { fmtEth, fmtDuration } from "@/lib/format";
import { filterByPeriod } from "@/lib/aggregate";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  Wallet,
  Wifi,
  Clock,
  Shield,
  Lock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const THRESHOLDS = {
  warnEth: 0.2,
  critEth: 0.05,
};

function tone(value: number, warn: number, crit: number): "green" | "amber" | "red" {
  if (value <= crit) return "red";
  if (value <= warn) return "amber";
  return "green";
}

function statusIcon(t: "green" | "amber" | "red") {
  const cls = "w-4 h-4";
  if (t === "green") return <CheckCircle2 className={cls + " text-accent-green"} />;
  if (t === "amber") return <AlertTriangle className={cls + " text-accent-amber"} />;
  return <XCircle className={cls + " text-accent-red"} />;
}

export default async function HealthPage() {
  const [
    chains,
    balances,
    allSweeps,
    allCredits,
    allSpends,
    allOps,
    allBurns,
    compliance,
    kycCounts,
    ofacCounts,
    depositorCounts,
    govEvents,
  ] = await Promise.all([
    getChainHealth(),
    getOperationalBalances(),
    Promise.all(SUPPORTED_CHAINS.map((c) => getSweepEvents(c))),
    Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerCredits(c))),
    Promise.all(SUPPORTED_CHAINS.map((c) => getLedgerSpends(c))),
    Promise.all(SUPPORTED_CHAINS.map((c) => getPaymasterOps(c))),
    Promise.all(SUPPORTED_CHAINS.map((c) => getCctpBurns(c))),
    getComplianceState(),
    getKycCounts(),
    getOfacCounts(),
    getDepositorCounts(),
    scanGovernance(),
  ]);

  // Surface governance-derived alerts on top of the existing health checks.
  const openRecoveryList = openRecoveries(govEvents);
  const legacyStates = legacySweeperState(govEvents);

  const opsAll = allOps.flat();
  const allChainsOk = chains.every((c) => c.ok);
  const allBalancesOk = balances.relayer.every(
    (b) => Number(b.ethBalance) / 1e18 > THRESHOLDS.warnEth
  );
  const recent24hOps = filterByPeriod(opsAll, "24h");
  const opsSuccess24h = recent24hOps.filter((o) => o.success).length;
  const opsTotal24h = recent24hOps.length;
  const successRate24h = opsTotal24h > 0 ? (opsSuccess24h / opsTotal24h) * 100 : 100;

  type FreshnessRow = { label: string; chainId: SupportedChainId; lastTs: number };
  const freshness: FreshnessRow[] = [];
  for (const chainId of SUPPORTED_CHAINS) {
    const idx = SUPPORTED_CHAINS.indexOf(chainId);
    freshness.push({
      label: "Last sweep",
      chainId,
      lastTs: allSweeps[idx].reduce((a, b) => Math.max(a, b.blockTimestamp), 0),
    });
    freshness.push({
      label: "Last ledger credit",
      chainId,
      lastTs: allCredits[idx].reduce((a, b) => Math.max(a, b.blockTimestamp), 0),
    });
    freshness.push({
      label: "Last ledger spend",
      chainId,
      lastTs: allSpends[idx].reduce((a, b) => Math.max(a, b.blockTimestamp), 0),
    });
    freshness.push({
      label: "Last paymaster op",
      chainId,
      lastTs: allOps[idx].reduce((a, b) => Math.max(a, b.blockTimestamp), 0),
    });
    freshness.push({
      label: "Last CCTP burn",
      chainId,
      lastTs: allBurns[idx].reduce((a, b) => Math.max(a, b.blockTimestamp), 0),
    });
  }

  const alerts: { chainId: SupportedChainId; severity: "warn" | "crit"; message: string }[] = [];
  for (const chainId of SUPPORTED_CHAINS) {
    const r = balances.relayer.find((b) => b.chainId === chainId);
    const p = balances.paymaster.find((b) => b.chainId === chainId);
    if (!r) continue;
    const relayerEth = Number(r.ethBalance) / 1e18;
    const paymasterEth = Number(p?.paymasterDeposit ?? 0n) / 1e18;
    if (relayerEth <= THRESHOLDS.critEth) {
      alerts.push({
        chainId,
        severity: "crit",
        message: `Relayer EOA on ${CHAIN_META[chainId].name} is at ${relayerEth.toFixed(4)} ETH — under the critical threshold (${THRESHOLDS.critEth} ETH). Refill immediately.`,
      });
    } else if (relayerEth <= THRESHOLDS.warnEth) {
      alerts.push({
        chainId,
        severity: "warn",
        message: `Relayer EOA on ${CHAIN_META[chainId].name} is at ${relayerEth.toFixed(4)} ETH — under the warning threshold (${THRESHOLDS.warnEth} ETH).`,
      });
    }
    if (paymasterEth <= THRESHOLDS.critEth && p?.address !== "0x0000000000000000000000000000000000000000") {
      alerts.push({
        chainId,
        severity: "crit",
        message: `Paymaster deposit on ${CHAIN_META[chainId].name} is at ${paymasterEth.toFixed(4)} ETH — under the critical threshold. Top up via EntryPoint.depositTo().`,
      });
    }
  }
  for (const c of chains) {
    if (!c.ok) {
      alerts.push({
        chainId: c.chainId,
        severity: "crit",
        message: `RPC for ${CHAIN_META[c.chainId].name} is unreachable: ${c.error ?? "unknown error"}`,
      });
    } else if (c.ageSeconds > 600) {
      alerts.push({
        chainId: c.chainId,
        severity: "warn",
        message: `Latest block on ${CHAIN_META[c.chainId].name} is ${fmtDuration(c.ageSeconds)} old — chain may be stalled.`,
      });
    }
  }
  for (const r of openRecoveryList) {
    alerts.push({
      chainId: r.chainId,
      severity: "crit",
      message: `Open recovery on account ${String(r.args.account ?? "").slice(0, 10)}… — security review required.`,
    });
  }
  for (const ls of legacyStates) {
    if (ls.enabled) {
      alerts.push({
        chainId: ls.chainId,
        severity: "crit",
        message: `Sweeper V1 LEGACY PATH enabled on ${CHAIN_META[ls.chainId].name} — re-exposes the C-1 ciphertext-substitution attack surface.`,
      });
    }
  }

  return (
    <div>
      <PageHeader
        title="Health"
        subtitle="RPC liveness · wallet balances · compliance gate state · event freshness across every chain."
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="RPC chains"
          value={`${chains.filter((c) => c.ok).length}/${chains.length}`}
          sublabel={allChainsOk ? "All reachable" : "Some unreachable"}
          tone={allChainsOk ? "green" : "red"}
          icon={<Wifi className="w-4 h-4" />}
        />
        <KpiCard
          label="Wallet health"
          value={`${balances.relayer.filter((b) => Number(b.ethBalance) / 1e18 > THRESHOLDS.warnEth).length}/${balances.relayer.length}`}
          sublabel={allBalancesOk ? "All above warn threshold" : "Refill recommended"}
          tone={allBalancesOk ? "green" : "amber"}
          icon={<Wallet className="w-4 h-4" />}
        />
        <KpiCard
          label="Success rate (24h)"
          value={`${successRate24h.toFixed(1)}%`}
          sublabel={`${opsSuccess24h}/${opsTotal24h} ops succeeded`}
          tone={successRate24h >= 99 ? "green" : successRate24h >= 90 ? "amber" : "red"}
          icon={<Activity className="w-4 h-4" />}
        />
        <KpiCard
          label="Active alerts"
          value={String(alerts.length)}
          sublabel={
            alerts.filter((a) => a.severity === "crit").length > 0
              ? `${alerts.filter((a) => a.severity === "crit").length} critical`
              : alerts.length > 0
              ? `${alerts.length} warnings`
              : "All clear"
          }
          tone={
            alerts.filter((a) => a.severity === "crit").length > 0
              ? "red"
              : alerts.length > 0
              ? "amber"
              : "green"
          }
          icon={
            alerts.length === 0 ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )
          }
        />
      </div>

      {alerts.length > 0 && (
        <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent-amber" />
            Alerts
          </h3>
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={
                  "flex items-start gap-3 p-3 rounded-md text-sm " +
                  (a.severity === "crit"
                    ? "bg-accent-red/10 border border-accent-red/30"
                    : "bg-accent-amber/10 border border-accent-amber/30")
                }
              >
                <span className="mt-0.5">
                  {a.severity === "crit" ? (
                    <XCircle className="w-4 h-4 text-accent-red" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-accent-amber" />
                  )}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <ChainBadge chainId={a.chainId} />
                    <span className="text-[11px] uppercase tracking-wider text-text-muted">
                      {a.severity}
                    </span>
                  </div>
                  <div>{a.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1 flex items-center gap-2">
            <Wifi className="w-4 h-4" />
            Chain RPC status
          </h3>
          <p className="text-xs text-text-muted mb-4">Latest block + freshness · live</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Latest block</th>
                <th className="pb-2 font-normal text-right">Age</th>
                <th className="pb-2 font-normal text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {chains.map((c) => {
                const status: "green" | "amber" | "red" = !c.ok
                  ? "red"
                  : c.ageSeconds > 600
                  ? "amber"
                  : "green";
                return (
                  <tr key={c.chainId} className="border-b border-border last:border-0">
                    <td className="py-3">
                      <ChainBadge chainId={c.chainId} />
                    </td>
                    <td className="py-3 text-right tabular-nums font-mono text-xs">
                      {c.ok ? c.latestBlock.toString() : "—"}
                    </td>
                    <td className="py-3 text-right text-text-muted text-xs">
                      {c.ok ? fmtDuration(c.ageSeconds) : "—"}
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex">{statusIcon(status)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1 flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Wallet balance health
          </h3>
          <p className="text-xs text-text-muted mb-4">
            Green &gt; {THRESHOLDS.warnEth} ETH · Amber &le; {THRESHOLDS.warnEth} · Red &le; {THRESHOLDS.critEth}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Relayer ETH</th>
                <th className="pb-2 font-normal text-right">Paymaster ETH</th>
                <th className="pb-2 font-normal text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_CHAINS.map((chainId) => {
                const r = balances.relayer.find((b) => b.chainId === chainId);
                const p = balances.paymaster.find((b) => b.chainId === chainId);
                const rEth = Number(r?.ethBalance ?? 0n) / 1e18;
                const pEth = Number(p?.paymasterDeposit ?? 0n) / 1e18;
                const status = tone(Math.min(rEth, pEth || rEth), THRESHOLDS.warnEth, THRESHOLDS.critEth);
                return (
                  <tr key={chainId} className="border-b border-border last:border-0">
                    <td className="py-3">
                      <ChainBadge chainId={chainId} />
                    </td>
                    <td className="py-3 text-right tabular-nums">{fmtEth(r?.ethBalance ?? 0n)}</td>
                    <td className="py-3 text-right tabular-nums">{fmtEth(p?.paymasterDeposit ?? 0n)}</td>
                    <td className="py-3 text-right">
                      <div className="inline-flex">{statusIcon(status)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <h3 className="font-medium mb-1 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Compliance gate state
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Z0tzComplianceGate live config + screening audit. FHEIP-0010 reference.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Chain</th>
              <th className="pb-2 font-normal">Gate</th>
              <th className="pb-2 font-normal text-right">Enabled</th>
              <th className="pb-2 font-normal text-right">Require KYC</th>
              <th className="pb-2 font-normal text-right">Policy v.</th>
              <th className="pb-2 font-normal text-right">Screened</th>
              <th className="pb-2 font-normal text-right">Denied</th>
              <th className="pb-2 font-normal text-right">Blacklist / Whitelist</th>
            </tr>
          </thead>
          <tbody>
            {compliance.map((c) => {
              const addr = ADDRESSES[c.chainId].complianceGate;
              return (
                <tr key={c.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={c.chainId} />
                  </td>
                  <td className="py-3">
                    {addr ? <ExplorerLink chainId={c.chainId} value={addr} type="address" /> : "—"}
                  </td>
                  <td className="py-3 text-right">
                    {c.enabled ? (
                      <span className="text-accent-green text-xs font-medium">enabled</span>
                    ) : (
                      <span className="text-text-muted text-xs">permissive</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    {c.requireKyc ? (
                      <span className="text-accent-amber text-xs font-medium">required</span>
                    ) : (
                      <span className="text-text-muted text-xs">optional</span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums text-xs">{c.policyVersion.toString()}</td>
                  <td className="py-3 text-right tabular-nums">{c.screenedTotal}</td>
                  <td className="py-3 text-right tabular-nums">
                    <span className={c.screenedDenied > 0 ? "text-accent-red" : "text-text-muted"}>
                      {c.screenedDenied}
                    </span>
                  </td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {c.blacklistedCount} / {c.whitelistedCount}
                  </td>
                </tr>
              );
            })}
            {compliance.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-text-muted">
                  No compliance gates wired.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1 flex items-center gap-2">
            <Lock className="w-4 h-4" />
            KYC registry
          </h3>
          <p className="text-xs text-text-muted mb-4">
            Per-chain attestations net of revocations
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Attested</th>
                <th className="pb-2 font-normal text-right">Revoked</th>
                <th className="pb-2 font-normal text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {kycCounts.map((k) => (
                <tr key={k.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={k.chainId} />
                  </td>
                  <td className="py-3 text-right tabular-nums">{k.attestedCount}</td>
                  <td className="py-3 text-right tabular-nums text-text-muted">{k.revokedCount}</td>
                  <td className="py-3 text-right tabular-nums font-medium">{k.netCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="font-medium mb-1 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            OFAC sanctions oracle
          </h3>
          <p className="text-xs text-text-muted mb-4">
            Per-chain sanctioned addresses net of un-sanctions
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal text-right">Sanctioned</th>
                <th className="pb-2 font-normal text-right">Removed</th>
                <th className="pb-2 font-normal text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {ofacCounts.map((o) => (
                <tr key={o.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={o.chainId} />
                  </td>
                  <td className="py-3 text-right tabular-nums">{o.sanctionedCount}</td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {o.unsanctionedCount}
                  </td>
                  <td className="py-3 text-right tabular-nums font-medium">{o.netCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <h3 className="font-medium mb-1 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Depositor registry — audit trail
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Append-only record of every gate-screened deposit. Cross-check this against ERC-20 Transfer logs to verify compliance integrity.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Chain</th>
              <th className="pb-2 font-normal">Registry</th>
              <th className="pb-2 font-normal text-right">Recorded deposits</th>
              <th className="pb-2 font-normal text-right">Unique depositors</th>
              <th className="pb-2 font-normal text-right">Total recorded (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {depositorCounts.map((d) => {
              const addr = ADDRESSES[d.chainId].depositorRegistry;
              return (
                <tr key={d.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={d.chainId} />
                  </td>
                  <td className="py-3">
                    {addr ? <ExplorerLink chainId={d.chainId} value={addr} type="address" /> : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums">{d.count}</td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {d.uniqueDepositors}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {(Number(d.totalRecorded) / 1e6).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Event source freshness
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Time since the most recent event of each type per chain.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Source</th>
              {SUPPORTED_CHAINS.map((chainId) => (
                <th key={chainId} className="pb-2 font-normal text-right">
                  <ChainBadge chainId={chainId} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                "Last sweep",
                "Last ledger credit",
                "Last ledger spend",
                "Last paymaster op",
                "Last CCTP burn",
              ] as const
            ).map((label) => (
              <tr key={label} className="border-b border-border last:border-0">
                <td className="py-3">{label}</td>
                {SUPPORTED_CHAINS.map((chainId) => {
                  const row = freshness.find((f) => f.label === label && f.chainId === chainId);
                  const ts = row?.lastTs ?? 0;
                  return (
                    <td key={chainId} className="py-3 text-right text-xs">
                      {ts > 0 ? (
                        <span className="text-text-muted">
                          {formatDistanceToNow(new Date(ts * 1000), { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="text-text-subtle">no events</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
