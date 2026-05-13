import { PageHeader } from "@/components/PageHeader";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { scanGovernance, type GovSeverity } from "@/lib/governance";
import { formatDistanceToNow } from "date-fns";
import { ShieldAlert, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const SEVERITY_STYLES: Record<GovSeverity, { bg: string; text: string; icon: JSX.Element }> = {
  critical: {
    bg: "bg-accent-red/10 border-accent-red/30",
    text: "text-accent-red",
    icon: <ShieldAlert className="w-4 h-4" />,
  },
  warn: {
    bg: "bg-accent-amber/10 border-accent-amber/30",
    text: "text-accent-amber",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  info: {
    bg: "bg-bg-elevated border-border",
    text: "text-text-muted",
    icon: <Info className="w-4 h-4" />,
  },
};

export default async function GovernancePage() {
  const events = await scanGovernance();

  const bySource = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.source] = (acc[e.source] ?? 0) + 1;
    return acc;
  }, {});

  const criticalCount = events.filter((e) => e.severity === "critical").length;
  const warnCount = events.filter((e) => e.severity === "warn").length;

  return (
    <div>
      <PageHeader
        title="Governance"
        subtitle="Admin / security / config events from every Z0tz contract — recovery, paymaster ops, sweeper legacy mode, ledger lock, Tezcatli vault changes."
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-2">
            Total governance events
          </div>
          <div className="text-2xl font-semibold tabular-nums">{events.length}</div>
          <div className="text-xs text-text-muted mt-1">
            All-time across 3 chains
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3 text-accent-red" />
            Critical
          </div>
          <div className="text-2xl font-semibold tabular-nums text-accent-red">
            {criticalCount}
          </div>
          <div className="text-xs text-text-muted mt-1">Treasury / operator / legacy mode</div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-accent-amber" />
            Warn
          </div>
          <div className="text-2xl font-semibold tabular-nums text-accent-amber">{warnCount}</div>
          <div className="text-xs text-text-muted mt-1">Config / fee model / whitelist</div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-2">
            By source
          </div>
          <div className="space-y-1 text-xs">
            {Object.entries(bySource).map(([source, count]) => (
              <div key={source} className="flex justify-between">
                <span className="text-text-muted">{source}</span>
                <span className="tabular-nums font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1">Event timeline</h3>
        <p className="text-xs text-text-muted mb-4">
          Newest first. Click any tx hash or contract address to verify on chain.
        </p>
        {events.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-accent-green" />
            <p className="text-sm text-text-muted">
              No governance events in scan window — all contracts holding steady.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((e, i) => {
              const style = SEVERITY_STYLES[e.severity];
              return (
                <div
                  key={`${e.chainId}-${e.txHash}-${i}`}
                  className={"flex items-start gap-3 p-3 rounded-md border " + style.bg}
                >
                  <span className={"mt-0.5 " + style.text}>{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <ChainBadge chainId={e.chainId} />
                      <span className={"text-[11px] uppercase tracking-wider font-medium " + style.text}>
                        {e.severity}
                      </span>
                      <span className="text-[11px] text-text-muted">·</span>
                      <span className="text-[11px] text-text-muted">{e.source}</span>
                      <span className="text-[11px] text-text-muted">·</span>
                      <span className="text-[11px] font-mono text-text-muted">{e.name}</span>
                    </div>
                    <div className="text-sm">{e.summary}</div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-text-muted">
                      {e.blockTimestamp > 0
                        ? formatDistanceToNow(new Date(e.blockTimestamp * 1000), { addSuffix: true })
                        : "—"}
                    </div>
                    <div className="mt-1">
                      <ExplorerLink chainId={e.chainId} value={e.txHash} type="tx" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
