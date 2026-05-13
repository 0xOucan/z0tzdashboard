"use client";

import { cn } from "@/lib/cn";

export function HourHeatmap({
  data,
  label,
}: {
  data: { hour: number; count: number }[];
  label: string;
}) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div>
      <div className="grid grid-cols-24 gap-1" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
        {data.map((d) => {
          const intensity = d.count / max;
          return (
            <div
              key={d.hour}
              title={`UTC ${d.hour.toString().padStart(2, "0")}:00 — ${d.count} ${label}`}
              className={cn(
                "h-10 rounded-sm flex items-end justify-center text-[10px] font-mono",
                intensity === 0 ? "bg-bg-elevated/40 text-text-subtle" : "text-bg"
              )}
              style={
                intensity === 0
                  ? undefined
                  : {
                      backgroundColor: `rgba(167, 139, 250, ${0.15 + intensity * 0.85})`,
                      color: intensity > 0.5 ? "#0a0a0b" : "#e5e7eb",
                    }
              }
            >
              <span className="pb-0.5">{d.hour}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-text-muted text-center">
        UTC hour of day (0 = midnight). Heat = relative {label} count.
      </div>
    </div>
  );
}
