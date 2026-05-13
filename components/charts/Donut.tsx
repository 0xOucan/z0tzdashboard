"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Slice = { label: string; value: number; color: string };

export function Donut({
  slices,
  height = 200,
  decimals = 0,
  unitLabel = "",
}: {
  slices: Slice[];
  height?: number;
  decimals?: number;
  unitLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="label"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={1}
          stroke="none"
        >
          {slices.map((s, i) => (
            <Cell key={i} fill={s.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#17171c",
            border: "1px solid #2e2e38",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(v: number) => [`${v.toFixed(decimals)}${unitLabel}`, ""]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
