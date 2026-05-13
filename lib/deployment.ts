/**
 * Resolve the actual chain block at the V6.5 deployment timestamp. Cached
 * for 24h — first cold start runs a ~25-probe binary search per chain (one
 * `getBlock` per probe); subsequent calls hit the cache.
 *
 * Lets event scans cover full history from deploy → latest instead of an
 * arbitrary lookback. SCAN_FROM_BLOCK_{chainId} env still wins if set.
 */
import { CHAIN_IDS, type SupportedChainId } from "./rpc";
import { publicClient } from "./chains";
import { cached } from "./cache";

/**
 * Deployment timestamps from
 *   /home/oucan/EVVM/FHE/Z0tz/contracts/deployments/v6.5-ledger-{chainId}.json
 *   .contracts.deployedAt
 *
 * Re-sync these if Z0tz redeploys V6.5.
 */
export const V65_DEPLOYED_AT: Record<SupportedChainId, string> = {
  [CHAIN_IDS.BASE_SEPOLIA]: "2026-05-01T16:41:35Z",
  [CHAIN_IDS.ETH_SEPOLIA]: "2026-05-01T16:52:50Z",
  [CHAIN_IDS.ARB_SEPOLIA]: "2026-05-01T16:34:12Z",
};

/** Buffer below the discovered deploy block so we don't miss the deploy tx itself. */
const SAFETY_BUFFER_BLOCKS = 100n;

/**
 * Find the smallest block on `chainId` whose timestamp ≥ `targetTs`.
 * Returns the resulting block number minus a small safety buffer so the
 * deploy transaction itself is included in subsequent event scans.
 */
async function blockAtTimestamp(chainId: SupportedChainId, targetTs: number): Promise<bigint> {
  const client = publicClient(chainId);
  let lo = 1n;
  let hi = await client.getBlockNumber();
  // Sanity bail-out: if the chain has fewer than 100 blocks, just start at 0.
  if (hi <= 100n) return 0n;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    let blockTs: number;
    try {
      const block = await client.getBlock({ blockNumber: mid });
      blockTs = Number(block.timestamp);
    } catch {
      // RPC failure mid-search — break out and return what we have.
      break;
    }
    if (blockTs < targetTs) {
      lo = mid + 1n;
    } else {
      hi = mid;
    }
  }
  return lo > SAFETY_BUFFER_BLOCKS ? lo - SAFETY_BUFFER_BLOCKS : 0n;
}

/**
 * Cached deployment block for a chain. 24h TTL.
 *
 * Failures (RPC down, timestamp unparseable) fall back to 0n; the
 * downstream scanner clips that to the active lookback window via
 * DEFAULT_LOOKBACK_BLOCKS so the dashboard still renders something.
 */
export async function deploymentBlock(chainId: SupportedChainId): Promise<bigint | null> {
  return cached(`deployBlock:${chainId}`, 86400, async () => {
    try {
      const iso = V65_DEPLOYED_AT[chainId];
      const ts = Math.floor(new Date(iso).getTime() / 1000);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      const block = await blockAtTimestamp(chainId, ts);
      // Discoverable but somehow zero → treat as "not found" so the scanner
      // falls back to DEFAULT_LOOKBACK_BLOCKS instead of scanning genesis.
      return block > 0n ? block : null;
    } catch (err) {
      console.warn(
        `deploymentBlock(${chainId}) lookup failed:`,
        (err as Error).message
      );
      return null;
    }
  });
}
