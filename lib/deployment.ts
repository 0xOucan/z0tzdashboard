/**
 * Resolve the actual chain block at the V6.5 deployment timestamp.
 *
 * Two-tier lookup, cached for 24h:
 *   1. Etherscan V2 `getblocknobytime` — one HTTP call returns the answer
 *      directly. Fast, deterministic, doesn't depend on RPC availability.
 *   2. viem binary search — ~25 `getBlock` calls walking the chain. Used
 *      only when no ETHERSCAN_API_KEY is configured or when Etherscan
 *      rejects the request.
 *
 * Lets event scans cover full history from deploy → latest instead of an
 * arbitrary lookback. SCAN_FROM_BLOCK_{chainId} env still wins if set.
 */
import { CHAIN_IDS, type SupportedChainId } from "./rpc";
import { publicClient } from "./chains";
import { cached } from "./cache";
import { readCheckpoint, writeCheckpoint } from "./persistent-cache";
import { waitForEtherscanSlot } from "./etherscanRateLimit";

/**
 * Deployment-block disk cache TTL. The block at a fixed timestamp can never
 * change so we cache for 7 days. The only reasons this could go stale:
 *   - V6.5 redeploys (operator should clear .z0tz-cache/deploy-block/)
 *   - Reorg-like rewrite of testnet blocks back through May 1 (won't happen)
 */
const DEPLOY_BLOCK_DISK_TTL_MS = 7 * 86_400_000;

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

const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";

/**
 * Etherscan path: one API call to map a timestamp → block number.
 * `closest=after` returns the first block AT or AFTER the timestamp.
 *
 * Uses up to 3 retries with exponential backoff + jitter to handle the
 * 3-req/sec free-tier rate limit across racing function instances.
 */
async function blockAtTimestampViaEtherscan(
  chainId: SupportedChainId,
  targetTs: number
): Promise<bigint | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) return null;
  const url = `${ETHERSCAN_V2}?chainid=${chainId}&module=block&action=getblocknobytime&timestamp=${targetTs}&closest=after&apikey=${apiKey}`;

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const base = 700 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 400;
      await new Promise((r) => setTimeout(r, base + jitter));
    }
    // Share the same rate-limit pacing as lib/explorerApi.ts — both files hit
    // the same Etherscan V2 endpoint and the limit is per-IP, not per-module.
    await waitForEtherscanSlot();
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (attempt === maxRetries) {
          console.warn(`deploymentBlock(${chainId}) Etherscan HTTP ${res.status} (final)`);
          return null;
        }
        continue;
      }
      const data = (await res.json()) as { status: string; message: string; result: string };
      const result = typeof data.result === "string" ? data.result : "";
      const isRateLimited = data.status === "0" && result.toLowerCase().includes("rate limit");
      if (isRateLimited && attempt < maxRetries) {
        continue;
      }
      if (data.status !== "1" || typeof data.result !== "string") {
        console.warn(
          `deploymentBlock(${chainId}) Etherscan rejected: ${data.message ?? "unknown"} (${data.result ?? ""}), falling back to viem`
        );
        return null;
      }
      return BigInt(data.result);
    } catch (err) {
      if (attempt === maxRetries) {
        console.warn(`deploymentBlock(${chainId}) Etherscan fetch failed: ${(err as Error).message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Fallback path: ~25-probe binary search across the chain. Used only when
 * Etherscan is unavailable.
 */
async function blockAtTimestampViaBinarySearch(
  chainId: SupportedChainId,
  targetTs: number
): Promise<bigint> {
  const client = publicClient(chainId);
  let lo = 1n;
  let hi = await client.getBlockNumber();
  if (hi <= 100n) return 0n;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    let blockTs: number;
    try {
      const block = await client.getBlock({ blockNumber: mid });
      blockTs = Number(block.timestamp);
    } catch {
      break;
    }
    if (blockTs < targetTs) {
      lo = mid + 1n;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Cached deployment block. 24h TTL. Tries Etherscan first; falls back to
 * viem binary search only if Etherscan is unavailable.
 *
 * Returns `null` when neither path succeeds — downstream callers
 * (lib/scanner.ts.getScanRange + lib/explorerApi.ts.fetchTxList) clip to
 * DEFAULT_LOOKBACK_BLOCKS in that case.
 */
type DiskDeployBlock = { blockStr: string; fetchedAt: number };

export async function deploymentBlock(chainId: SupportedChainId): Promise<bigint | null> {
  return cached(`deployBlock:${chainId}`, 86400, async () => {
    // ── Tier 1: disk cache (survives across function instances)
    const diskKey = `deploy-block/${chainId}`;
    const disk = await readCheckpoint<DiskDeployBlock>(diskKey);
    if (disk && Date.now() - disk.fetchedAt < DEPLOY_BLOCK_DISK_TTL_MS) {
      try {
        return BigInt(disk.blockStr);
      } catch {
        // corrupt entry, fall through and refetch
      }
    }

    try {
      const iso = V65_DEPLOYED_AT[chainId];
      const ts = Math.floor(new Date(iso).getTime() / 1000);
      if (!Number.isFinite(ts) || ts <= 0) return null;

      // ── Tier 2: Etherscan getblocknobytime (one HTTP call)
      const viaEtherscan = await blockAtTimestampViaEtherscan(chainId, ts);
      if (viaEtherscan !== null && viaEtherscan > 0n) {
        const block = viaEtherscan > SAFETY_BUFFER_BLOCKS ? viaEtherscan - SAFETY_BUFFER_BLOCKS : 0n;
        console.info(
          `deploymentBlock(${chainId}) via Etherscan: block ${block} (raw ${viaEtherscan}, ts ${ts})`
        );
        // Persist for the next function instance
        void writeCheckpoint<DiskDeployBlock>(diskKey, {
          blockStr: block.toString(),
          fetchedAt: Date.now(),
        });
        return block;
      }

      // ── Tier 3: viem binary search fallback (~25 RPC calls)
      const raw = await blockAtTimestampViaBinarySearch(chainId, ts);
      if (raw === 0n) return null;
      const block = raw > SAFETY_BUFFER_BLOCKS ? raw - SAFETY_BUFFER_BLOCKS : 0n;
      console.info(
        `deploymentBlock(${chainId}) via viem binary search: block ${block} (raw ${raw}, ts ${ts})`
      );
      if (block > 0n) {
        void writeCheckpoint<DiskDeployBlock>(diskKey, {
          blockStr: block.toString(),
          fetchedAt: Date.now(),
        });
        return block;
      }
      return null;
    } catch (err) {
      console.warn(
        `deploymentBlock(${chainId}) lookup failed:`,
        (err as Error).message
      );
      return null;
    }
  });
}
