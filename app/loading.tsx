export default function Loading() {
  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="h-7 w-40 rounded bg-bg-card animate-pulse" />
          <div className="h-4 w-72 rounded bg-bg-card animate-pulse mt-2" />
        </div>
        <div className="h-8 w-44 rounded bg-bg-card animate-pulse" />
      </div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-bg-card border border-border rounded-lg p-5">
            <div className="h-3 w-24 rounded bg-bg-elevated animate-pulse mb-3" />
            <div className="h-7 w-32 rounded bg-bg-elevated animate-pulse mb-2" />
            <div className="h-3 w-36 rounded bg-bg-elevated animate-pulse" />
          </div>
        ))}
      </div>
      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <div className="h-4 w-48 rounded bg-bg-elevated animate-pulse mb-1" />
        <div className="h-3 w-72 rounded bg-bg-elevated animate-pulse mb-4" />
        <div className="h-64 rounded bg-bg-elevated/40 animate-pulse" />
      </div>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <div className="w-2 h-2 rounded-full bg-accent-blue animate-pulse" />
        Scanning chain events across Base / Eth / Arb Sepolia — 10–30s on cold start, &lt;1s after.
      </div>
    </div>
  );
}
