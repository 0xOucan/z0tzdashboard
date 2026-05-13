"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHAIN_META, SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/rpc";

type Datum = { day: string; chainBuckets: Record<SupportedChainId, number> };

export function StackedBarChart({
  data,
  unitLabel,
  decimals = 0,
}: {
  data: Datum[];
  unitLabel: string;
  decimals?: number;
}) {
  const flat = data.map((d) => ({ day: d.day, ...d.chainBuckets }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={flat} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          labelStyle={{ color: "#9ca3af" }}
          formatter={(value: number) => [`${value.toFixed(decimals)} ${unitLabel}`, ""]}
        />
        {SUPPORTED_CHAINS.map((chainId) => (
          <Bar
            key={chainId}
            dataKey={chainId}
            stackId="a"
            fill={CHAIN_META[chainId].color}
            name={CHAIN_META[chainId].name}
            radius={[2, 2, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
