import { ChainBadge } from "./ChainBadge";
import { ExplorerLink } from "./ExplorerLink";
import type { SupportedChainId } from "@/lib/rpc";
import { formatDistanceToNow } from "date-fns";

type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
};

export function EventTable<T extends { chainId: SupportedChainId; blockTimestamp: number; txHash: `0x${string}` }>({
  rows,
  columns,
  emptyMessage = "No events in the selected window.",
}: {
  rows: T[];
  columns: Column<T>[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-text-muted">{emptyMessage}</div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
          <th className="pb-2 font-normal w-24">Chain</th>
          {columns.map((c, i) => (
            <th
              key={i}
              className={"pb-2 font-normal " + (c.align === "right" ? "text-right" : "")}
              style={c.width ? { width: c.width } : undefined}
            >
              {c.header}
            </th>
          ))}
          <th className="pb-2 font-normal text-right">When</th>
          <th className="pb-2 font-normal text-right w-28">Proof</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border last:border-0 hover:bg-bg-elevated/40">
            <td className="py-2.5">
              <ChainBadge chainId={row.chainId} />
            </td>
            {columns.map((c, j) => (
              <td key={j} className={"py-2.5 " + (c.align === "right" ? "text-right tabular-nums" : "")}>
                {c.cell(row)}
              </td>
            ))}
            <td className="py-2.5 text-right text-text-muted text-xs">
              {row.blockTimestamp > 0
                ? formatDistanceToNow(new Date(row.blockTimestamp * 1000), { addSuffix: true })
                : "—"}
            </td>
            <td className="py-2.5 text-right">
              <ExplorerLink chainId={row.chainId} value={row.txHash} type="tx" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
