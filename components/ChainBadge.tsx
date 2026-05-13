import { CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { cn } from "@/lib/cn";

export function ChainBadge({ chainId, className }: { chainId: SupportedChainId; className?: string }) {
  const meta = CHAIN_META[chainId];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium uppercase tracking-wider border",
        className
      )}
      style={{ borderColor: meta.color + "60", color: meta.color, backgroundColor: meta.color + "12" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.short}
    </span>
  );
}
