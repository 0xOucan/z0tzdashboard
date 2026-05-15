/**
 * Tail-first event scanner. Walks backwards from the latest block, scanning
 * 9_000-block chunks (the getLogs ceiling on most public RPCs), stopping when
 * either (a) we've collected MAX_EVENTS_PER_SOURCE events or (b) we hit the
 * configured scan floor (deployment block via env, or DEFAULT_LOOKBACK_BLOCKS
 * fallback).
 *
 * "Sandwich polling": Next.js `revalidate: N` runs the fresh scan in the
 * background while serving the cached snapshot — so a warm dashboard renders
 * in <100 ms and freshness is bounded by N seconds.
 */
import type { PublicClient } from "viem";
import { publicClient } from "./chains";
import {
  DEFAULT_LOOKBACK_BLOCKS,
  MAX_EVENTS_PER_SOURCE,
  scanFromBlockOverride,
} from "./addresses";
import { cached } from "./cache";
import { deploymentBlock } from "./deployment";
import type { SupportedChainId } from "./rpc";

/**
 * Per-chain getLogs chunk size. Public RPCs cap eth_getLogs response size
 * and arbitrum-sepolia in particular sees frequent transient HTTP failures
 * on the standard 9000-block window because of high tx density; halving
 * the window for arb reduces the chunk size each request needs to return
 * and improves scan reliability.
 *
 * Falls back to the default 9000 for any chain not explicitly listed.
 */
const CHUNK_SIZE_BY_CHAIN: Record<number, bigint> = {
  421614: 4_500n, // arb-sepolia: high tx density, half-window reduces timeouts
  84532: 4_500n, // base-sepolia: similar story for Tezcatli vault scans
};
export const CHUNK_SIZE = 9_000n;
function chunkSizeFor(chainId: number): bigint {
  return CHUNK_SIZE_BY_CHAIN[chainId] ?? CHUNK_SIZE;
}

/**
 * Cached current-block-number. ~10s TTL — multiple event readers in the same
 * request hit the cache, so we collapse N getBlockNumber calls into one.
 */
export async function latestBlock(chainId: SupportedChainId): Promise<bigint> {
  return cached(`latestBlock:${chainId}`, 10, async () => {
    return publicClient(chainId).getBlockNumber();
  });
}

/**
 * Resolve the (from, to) block range a scan should cover. Priority:
 *   1. SCAN_FROM_BLOCK_{chainId} env override — operator-controlled hard floor.
 *   2. V6.5 deployment block from lib/deployment.ts — binary-searched once
 *      per 24h. Gives full history.
 *   3. DEFAULT_LOOKBACK_BLOCKS fallback — used only if deployment lookup
 *      fails (RPC issue, missing timestamp).
 */
export async function getScanRange(
  chainId: SupportedChainId,
  client?: PublicClient
): Promise<{ from: bigint; to: bigint }> {
  const to = client ? await client.getBlockNumber() : await latestBlock(chainId);
  const override = scanFromBlockOverride(chainId);
  if (override !== null) return { from: override, to };

  const deployBlock = await deploymentBlock(chainId);
  if (deployBlock !== null) {
    // Clip from above by `to` (shouldn't happen except on a fresh chain).
    return { from: deployBlock > to ? to : deployBlock, to };
  }

  const lookback = DEFAULT_LOOKBACK_BLOCKS[chainId];
  const from = to > lookback ? to - lookback : 0n;
  return { from, to };
}

/**
 * Tail-first chunked scanner. `fetch` is called once per chunk with the
 * (start, end) range INCLUSIVE. Caller can early-terminate by throwing
 * inside fetch — we swallow per-chunk errors and continue with a warning.
 */
export async function scanLogsReverse<T>(
  client: PublicClient,
  from: bigint,
  to: bigint,
  fetch: (start: bigint, end: bigint) => Promise<T[]>,
  maxEvents: number = MAX_EVENTS_PER_SOURCE
): Promise<T[]> {
  const chainId = client.chain?.id ?? 0;
  const chunkSize = chunkSizeFor(chainId);
  const results: T[] = [];
  let cursor = to;
  while (cursor >= from && results.length < maxEvents) {
    const chunkStart = cursor > from + chunkSize ? cursor - chunkSize : from;
    try {
      const chunk = await fetch(chunkStart, cursor);
      results.push(...chunk);
    } catch (err) {
      console.warn(
        `scanLogsReverse chunk ${chunkStart}-${cursor} failed:`,
        (err as Error).message
      );
    }
    if (chunkStart === from) break;
    cursor = chunkStart - 1n;
  }
  return results;
}

/**
 * Helper: pull block timestamps for a set of events in one shot. Dedupes
 * unique blockNumbers and runs `getBlock` in parallel.
 */
export async function withBlockTimestamps<T extends { blockNumber: bigint }>(
  client: PublicClient,
  events: T[]
): Promise<(T & { blockTimestamp: number })[]> {
  const blocks = new Map<bigint, number>();
  const uniqueBlocks = Array.from(new Set(events.map((e) => e.blockNumber)));
  await Promise.all(
    uniqueBlocks.map(async (bn) => {
      try {
        const block = await client.getBlock({ blockNumber: bn });
        blocks.set(bn, Number(block.timestamp));
      } catch {
        blocks.set(bn, 0);
      }
    })
  );
  return events.map((e) => ({ ...e, blockTimestamp: blocks.get(e.blockNumber) ?? 0 }));
}
