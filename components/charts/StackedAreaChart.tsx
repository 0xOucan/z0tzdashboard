"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHAIN_META, SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/rpc";

type Datum = { day: string; chainBuckets: Record<SupportedChainId, number> };

export function StackedAreaChart({
  data,
  unitLabel,
  decimals = 0,
  height = 260,
}: {
  data: Datum[];
  unitLabel: string;
  decimals?: number;
  height?: number;
}) {
  const flat = data.map((d) => ({ day: d.day, ...d.chainBuckets }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={flat} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickFormatter={(d) => d.slice(5)}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#17171c",
            border: "1px solid #2e2e38",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(v: number) => [`${v.toFixed(decimals)} ${unitLabel}`, ""]}
        />
        {SUPPORTED_CHAINS.map((chainId) => (
          <Area
            key={chainId}
            type="monotone"
            dataKey={chainId}
            stackId="a"
            stroke={CHAIN_META[chainId].color}
            fill={CHAIN_META[chainId].color}
            fillOpacity={0.4}
            name={CHAIN_META[chainId].name}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
