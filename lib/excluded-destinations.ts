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
    // Same R&D batch — 4× 0.003 ETH burners on base-sepolia. Per-tx
    // hashes for provenance (verify on basescan-sepolia if memory fades):
    //   0x8c35b6c3654a1d6ca98236e04bdceb7444d54dfca016cc1fe3e0f5cfc330d55e
    //   0xd9a20ff7409a733d7fe96293b1fb96791e6bb21a0de92aa6600f21e0bf1be5cf
    //   0x54df7198d285643d064b4e8fc1be4f0029bc374bccfe1bd4839b160c0e95b2e8
    //   0x241df548227e615279413108a7083840e1d44a14abe34e5dd8fc48c0c3a30cd4
    "0xcb2f65ac0f8036db97307077a6c9c2a026a3ae74",
    "0x3964481d8d59e81dfdbbe47b55268045fccc57c3",
    "0x412bf81f25330edf9fec243a6e5a3c525ae2173d",
    "0xe8f345a402fe83c9ff8aeb9fbe2d4b53da4e08da",
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
