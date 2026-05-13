export const PERIODS = ["24h", "7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * Daily bucket count per period — drives the x-axis span of every chart.
 * "all" → 90 days is generous enough for V6.5 testnet history (deployed
 * 2026-05-01). Bump higher once trailing history exceeds three months.
 */
export const PERIOD_DAYS: Record<Period, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  all: 90,
};

export function parsePeriod(value: string | null | undefined): Period {
  if (value && (PERIODS as readonly string[]).includes(value)) return value as Period;
  return "all";
}
