"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  Fuel,
  Coins,
  ArrowLeftRight,
  FileCode2,
  Activity,
  TrendingUp,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/cashin", label: "Cash In", icon: ArrowDownToLine },
  { href: "/cashout", label: "Cash Out", icon: ArrowUpFromLine },
  { href: "/gas", label: "Gas", icon: Fuel },
  { href: "/defi", label: "DeFi", icon: Coins },
  { href: "/bridge", label: "Bridge", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: TrendingUp },
  { href: "/health", label: "Health", icon: Activity },
  { href: "/contracts", label: "Contracts", icon: FileCode2 },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-bg-card flex flex-col">
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xl">🦇</span>
          <div>
            <div className="font-semibold tracking-tight">Z0tz</div>
            <div className="text-[11px] text-text-muted uppercase tracking-wider">admin dashboard</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-bg-elevated text-text font-medium"
                  : "text-text-muted hover:text-text hover:bg-bg-elevated/60"
              )}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-border text-[11px] text-text-subtle">
        Testnet · Base · Eth · Arb
      </div>
    </aside>
  );
}
