"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { PERIODS, type Period } from "./period";

export function PeriodSelector({ active }: { active: Period }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <div className="inline-flex rounded-md border border-border bg-bg-card overflow-hidden text-xs">
      {PERIODS.map((p) => {
        const isActive = p === active;
        return (
          <button
            key={p}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("period", p);
              router.push("?" + next.toString());
            }}
            className={cn(
              "px-3 py-1.5 transition-colors font-medium",
              isActive
                ? "bg-bg-elevated text-text"
                : "text-text-muted hover:text-text hover:bg-bg-elevated/40"
            )}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}
