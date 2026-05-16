/**
 * Per-chain set of relayer-funded addresses to EXCLUDE from cost accounting.
 *
 * The relayer wallet occasionally funds addresses for non-Z0tz reasons:
 *   - WalletConnect burner stealths used to test dApps (Aave supply,
 *     Uniswap swap, etc. — the gas paid here isn't part of the ledger's
 *     unit economics; it's R&D)
 *   - Manual gas-refund tests
 *   - One-off bounces between operator wallets
 *
 * Counting these as realized cost makes the break-even math look much
 * worse than reality. Anything listed here is:
 *   1. Bucketed under `excludedOutflow` in RelayerCashFlow instead of
 *      stealthOutflow → no effect on stealthNetCost / per-chain P&L
 *   2. Classified as "excluded" in lib/audit.ts → no longer skews the
 *      "unknown" bucket
 *
 * Lowercase keys only. Add new ones with a comment explaining what they
 * were funded for so future-you knows whether to keep the exclusion.
 */
import { CHAIN_IDS, type SupportedChainId } from "./rpc";

export const EXCLUDED_DESTINATIONS: Record<SupportedChainId, Set<string>> = {
  [CHAIN_IDS.BASE_SEPOLIA]: new Set<string>([
    // 2026-05-10 — WalletConnect Aave test. Relayer sent 0.083 ETH for
    // Aave Supply + Mint + Approve sequence via the GUI dApps tab. Not
    // Z0tz core flow; classified as R&D.
    "0x9708bf5eca1f39b8b693d3d7111e969efb76fbd9",
  ]),
  [CHAIN_IDS.ETH_SEPOLIA]: new Set<string>(),
  [CHAIN_IDS.ARB_SEPOLIA]: new Set<string>(),
};

export function isExcludedDestination(
  chainId: SupportedChainId,
  address: string
): boolean {
  return EXCLUDED_DESTINATIONS[chainId]?.has(address.toLowerCase()) ?? false;
}
