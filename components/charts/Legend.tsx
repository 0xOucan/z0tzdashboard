import { CHAIN_META, SUPPORTED_CHAINS } from "@/lib/rpc";

export function ChainLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-text-muted">
      {SUPPORTED_CHAINS.map((chainId) => (
        <div key={chainId} className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: CHAIN_META[chainId].color }}
          />
          {CHAIN_META[chainId].name}
        </div>
      ))}
    </div>
  );
}
