export const PERIODS = ["24h", "7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(value: string | null | undefined): Period {
  if (value && (PERIODS as readonly string[]).includes(value)) return value as Period;
  return "7d";
}
