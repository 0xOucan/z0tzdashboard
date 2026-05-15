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
 */
async function blockAtTimestampViaEtherscan(
  chainId: SupportedChainId,
  targetTs: number
): Promise<bigint | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) return null;
  const url = `${ETHERSCAN_V2}?chainid=${chainId}&module=block&action=getblocknobytime&timestamp=${targetTs}&closest=after&apikey=${apiKey}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`deploymentBlock(${chainId}) Etherscan HTTP ${res.status}, falling back to viem`);
      return null;
    }
    const data = (await res.json()) as { status: string; message: string; result: string };
    if (data.status !== "1" || typeof data.result !== "string") {
      console.warn(
        `deploymentBlock(${chainId}) Etherscan rejected: ${data.message ?? "unknown"} (${data.result ?? ""}), falling back to viem`
      );
      return null;
    }
    return BigInt(data.result);
  } catch (err) {
    console.warn(`deploymentBlock(${chainId}) Etherscan fetch failed: ${(err as Error).message}`);
    return null;
  }
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
export async function deploymentBlock(chainId: SupportedChainId): Promise<bigint | null> {
  return cached(`deployBlock:${chainId}`, 86400, async () => {
    try {
      const iso = V65_DEPLOYED_AT[chainId];
      const ts = Math.floor(new Date(iso).getTime() / 1000);
      if (!Number.isFinite(ts) || ts <= 0) return null;

      // ── Fast path: Etherscan
      const viaEtherscan = await blockAtTimestampViaEtherscan(chainId, ts);
      if (viaEtherscan !== null && viaEtherscan > 0n) {
        const block = viaEtherscan > SAFETY_BUFFER_BLOCKS ? viaEtherscan - SAFETY_BUFFER_BLOCKS : 0n;
        console.info(
          `deploymentBlock(${chainId}) via Etherscan: block ${block} (raw ${viaEtherscan}, ts ${ts})`
        );
        return block;
      }

      // ── Fallback: viem binary search
      const raw = await blockAtTimestampViaBinarySearch(chainId, ts);
      if (raw === 0n) return null;
      const block = raw > SAFETY_BUFFER_BLOCKS ? raw - SAFETY_BUFFER_BLOCKS : 0n;
      console.info(
        `deploymentBlock(${chainId}) via viem binary search: block ${block} (raw ${raw}, ts ${ts})`
      );
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
