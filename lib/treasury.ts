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
  /** Paymaster gas burn (via EntryPoint UserOperationEvent), wei. */
  gasSpentWei: bigint;
  /**
   * Net ETH the relayer EOA has sent directly to stealths (outflow − dust
   * returns), wei. Captured from explorer API tx history; will be 0n when
   * the explorer API keys aren't configured.
   */
  relayerDirectSpendWei?: bigint;
  /** Total cash-in volume, in USDC 6-decimal units. */
  cashinVolumeUsdc: bigint;
  /** ETH spot price in USD. */
  ethUsd: number;
};

export type TreasuryEconomics = {
  sweeperFeesUsd: number;
  paymasterGasUsd: number;
  relayerDirectSpendUsd: number;
  totalCostUsd: number; // paymaster + direct
  cashinVolumeUsd: number;
  netUsd: number; // fees − total cost; positive = profitable
  coverage: number; // fees / total cost; 1.0 = break-even
  breakEvenAdditionalCashinUsd: number;
  status: "profit" | "breakeven" | "loss";
};

export function computeTreasury(s: TreasurySnapshot): TreasuryEconomics {
  const sweeperFeesUsd = Number(s.sweeperFeesUsdc) / 1e6;
  const paymasterGasUsd = (Number(s.gasSpentWei) / 1e18) * s.ethUsd;
  const relayerDirectSpendUsd =
    (Number(s.relayerDirectSpendWei ?? 0n) / 1e18) * s.ethUsd;
  const totalCostUsd = paymasterGasUsd + relayerDirectSpendUsd;
  const cashinVolumeUsd = Number(s.cashinVolumeUsdc) / 1e6;
  const netUsd = sweeperFeesUsd - totalCostUsd;
  const coverage = totalCostUsd > 0 ? sweeperFeesUsd / totalCostUsd : Number.POSITIVE_INFINITY;
  const additionalCashinNeeded = Math.max(0, (totalCostUsd - sweeperFeesUsd) / SWEEPER_FEE_RATE);

  let status: "profit" | "breakeven" | "loss" = "loss";
  if (netUsd >= 0) status = "profit";
  else if (coverage >= 0.95) status = "breakeven";

  return {
    sweeperFeesUsd,
    paymasterGasUsd,
    relayerDirectSpendUsd,
    totalCostUsd,
    cashinVolumeUsd,
    netUsd,
    coverage,
    breakEvenAdditionalCashinUsd: additionalCashinNeeded,
    status,
  };
}
