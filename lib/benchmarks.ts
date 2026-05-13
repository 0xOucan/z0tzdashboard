/**
 * Reference gas + cost figures from the 2026-05-02 V6.5 + Tezcatli super-run
 * (/Z0tz/benchmarks/2026-05-02-v65-defi-super.md). Used by the /gas page to
 * flag drift between observed avg gas and the benchmark baseline.
 *
 * Update this file when the benchmark is re-run and the contracts change.
 */
import type { OpClass } from "./analytics";

export type BenchmarkOp = {
  klass: OpClass;
  label: string;
  /** Average gas observed across the 106-tx super-run. */
  avgGas: number;
  /** Total count of this op-type in the super-run. */
  count: number;
  /** Phase number(s) in the benchmark this op appeared in. */
  phases: string;
};

export const BENCHMARK: { runDate: string; ops: BenchmarkOp[] } = {
  runDate: "2026-05-02",
  ops: [
    {
      klass: "defiDeposit",
      label: "defi-tezcatli-deposit",
      avgGas: 1_710_000,
      count: 3, // 2 in Phase 9 + 1 in Phase 8
      phases: "8, 9",
    },
    {
      klass: "defiWithdraw",
      label: "defi-tezcatli-withdraw",
      avgGas: 929_000,
      count: 2,
      phases: "9",
    },
    {
      klass: "cashout",
      label: "xc-cashout / defi-ledger-cashout",
      avgGas: 761_000,
      count: 14, // 6 + 6 + 2
      phases: "6, 7, 9",
    },
    {
      klass: "cashin",
      label: "cashin / dst-sweep / unshield",
      avgGas: 540_000, // weighted: 633K cashin (3), 530K dst-sweep (6), 500K unshield (12)
      count: 21,
      phases: "4, 6, 7",
    },
  ],
};

/**
 * Per-chain testnet gas-price calibration derived from the same super-run.
 * (totalEthCost / totalGas → effective gwei). Useful for sanity-checking
 * if a chain's gwei changed dramatically since the benchmark.
 */
export const BENCHMARK_GAS_PRICE_GWEI: Record<number, number> = {
  421614: 0.02, // arb-sepolia: 0.00044664 ETH / 22.26M gas
  84532: 0.006, // base-sepolia: 0.00006093 ETH / 10.16M gas
  11155111: 0.001, // eth-sepolia: 0.00001012 ETH / 10.12M gas
};

/**
 * Per-flow USDC fee budget — useful for /analytics to compare expected
 * sweeper-fee revenue against observed.
 */
export const BENCHMARK_USDC_FEES = {
  sweeperFeeBps: 100, // 1% on every privateSweepToLedger
  cctpFeeBpsBaseArb: 1.3, // Fast Transfer fee
  cctpFeeBpsEth: 1.0,
  perFlow: [
    { flow: "Cash-in 20 USDC", feeUsdc: 0.2 },
    { flow: "Bridge 1 USDC (ledger → ledger)", feeUsdc: 0.0203 },
    { flow: "XC-Cashout 1 USDC (ledger → EOA)", feeUsdc: 0.0231 },
    { flow: "Same-chain DeFi roundtrip 1 USDC", feeUsdc: 0.0201 },
    { flow: "Cross-chain DeFi roundtrip 1 USDC", feeUsdc: 0.0331 },
  ],
};
