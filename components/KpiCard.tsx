import { cn } from "@/lib/cn";

export function KpiCard({
  label,
  value,
  sublabel,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "green" | "red" | "amber" | "blue";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    neutral: "text-text",
    green: "text-accent-green",
    red: "text-accent-red",
    amber: "text-accent-amber",
    blue: "text-accent-blue",
  }[tone];

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-text-muted">{label}</span>
        {icon && <span className="text-text-subtle">{icon}</span>}
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
      {sublabel && <div className="text-xs text-text-muted mt-1">{sublabel}</div>}
    </div>
  );
}
