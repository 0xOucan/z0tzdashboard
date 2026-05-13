"use client";

import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Datum = { day: string; value: number };

export function SingleLineChart({
  data,
  color = "#a78bfa",
  unitLabel,
  decimals = 0,
  height = 240,
}: {
  data: Datum[];
  color?: string;
  unitLabel: string;
  decimals?: number;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickFormatter={(d) => (typeof d === "string" ? d.slice(5) : d)}
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
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </ReLineChart>
    </ResponsiveContainer>
  );
}
