/**
 * Treasury economics — sweeper fee revenue vs paymaster gas spend.
 *
 * The Z0tz relayer's business model: collect 1% of every cash-in as a
 * sweeper fee (USDC into treasury) and pay paymaster gas in ETH. Profit
 * is the dollar delta between fees collected and gas spent.
 *
 *   netUsd = sweeperFeesUsdc − gasSpentUsd
 *   coverage = sweeperFeesUsdc / gasSpentUsd  (1.00 = exact break-even)
 *   breakEvenCashinUsdc = max(0, gasSpentUsd / SWEEPER_FEE_RATE)
 *
 * On testnet, expect this to be deeply negative — test runs burn gas
 * without real fee volume. The number-to-watch is **how much cash-in
 * volume per day** to flip the gas spend positive.
 */
export const SWEEPER_FEE_BPS = 100; // 1% — matches contract feeBps
export const SWEEPER_FEE_RATE = SWEEPER_FEE_BPS / 10_000; // 0.01

export type TreasurySnapshot = {
  /** Total sweeper fees collected, in USDC 6-decimal units. */
  sweeperFeesUsdc: bigint;
  /** Total paymaster + relayer gas spent, in wei. */
  gasSpentWei: bigint;
  /** Total cash-in volume, in USDC 6-decimal units. */
  cashinVolumeUsdc: bigint;
  /** ETH spot price in USD. */
  ethUsd: number;
};

export type TreasuryEconomics = {
  sweeperFeesUsd: number;
  gasSpentUsd: number;
  cashinVolumeUsd: number;
  netUsd: number; // fees − gas; positive = profitable
  coverage: number; // fees / gas; 1.0 = break-even
  breakEvenAdditionalCashinUsd: number; // USDC cash-in still needed to cover
  status: "profit" | "breakeven" | "loss";
};

export function computeTreasury(s: TreasurySnapshot): TreasuryEconomics {
  const sweeperFeesUsd = Number(s.sweeperFeesUsdc) / 1e6;
  const gasSpentUsd = (Number(s.gasSpentWei) / 1e18) * s.ethUsd;
  const cashinVolumeUsd = Number(s.cashinVolumeUsdc) / 1e6;
  const netUsd = sweeperFeesUsd - gasSpentUsd;
  const coverage = gasSpentUsd > 0 ? sweeperFeesUsd / gasSpentUsd : Number.POSITIVE_INFINITY;
  const additionalCashinNeeded = Math.max(0, (gasSpentUsd - sweeperFeesUsd) / SWEEPER_FEE_RATE);

  let status: "profit" | "breakeven" | "loss" = "loss";
  if (netUsd >= 0) status = "profit";
  else if (coverage >= 0.95) status = "breakeven";

  return {
    sweeperFeesUsd,
    gasSpentUsd,
    cashinVolumeUsd,
    netUsd,
    coverage,
    breakEvenAdditionalCashinUsd: additionalCashinNeeded,
    status,
  };
}
