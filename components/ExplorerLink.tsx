import { ExternalLink } from "lucide-react";
import { addressUrl, txUrl } from "@/lib/explorer";
import { shortAddress } from "@/lib/format";
import type { SupportedChainId } from "@/lib/rpc";
import { cn } from "@/lib/cn";

export function ExplorerLink({
  chainId,
  value,
  type,
  label,
  className,
  showIcon = true,
}: {
  chainId: SupportedChainId;
  value: string;
  type: "tx" | "address";
  label?: string;
  className?: string;
  showIcon?: boolean;
}) {
  const href = type === "tx" ? txUrl(chainId, value) : addressUrl(chainId, value);
  const display = label ?? shortAddress(value);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs hover:text-accent transition-colors",
        className
      )}
    >
      {display}
      {showIcon && <ExternalLink className="w-3 h-3 opacity-60" />}
    </a>
  );
}
