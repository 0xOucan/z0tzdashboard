/**
 * Higher-order helper for incremental event scans. Reads the prior session's
 * checkpoint (block + events) off disk, scans only the delta from
 * `checkpoint.lastBlock + 1` to `latest`, merges, persists, returns.
 *
 * First run with no checkpoint falls back to lib/scanner.ts.getScanRange()
 * (deployment block → latest, soft-capped at MAX_EVENTS_PER_SOURCE).
 */
import type { Address, PublicClient } from "viem";
import { publicClient } from "./chains";
import {
  getScanRange,
  latestBlock,
  scanLogsReverse,
  withBlockTimestamps,
} from "./scanner";
import { MAX_EVENTS_PER_SOURCE } from "./addresses";
import { readCheckpoint, writeCheckpoint } from "./persistent-cache";
import type { SupportedChainId } from "./rpc";

const ZERO = "0x0000000000000000000000000000000000000000";

type StoredCheckpoint<T> = {
  contractAddress: string; // lowercase
  lastBlock: bigint;
  events: T[];
  updatedAt: number;
};

export type IncrementalScanOpts<TRaw, TOut> = {
  chainId: SupportedChainId;
  contractAddress: Address | null;
  /** Unique per (contract, event). Becomes the cache file name. */
  eventKey: string;
  /** Pull raw logs for a (from, to) inclusive range. */
  getLogs: (client: PublicClient, from: bigint, to: bigint) => Promise<TRaw[]>;
  /** Decode one raw log into the canonical UI shape (excluding blockTimestamp). */
  decode: (
    raw: TRaw,
    chainId: SupportedChainId
  ) => Omit<TOut, "blockTimestamp"> & { blockNumber: bigint };
};

export async function incrementalScan<
  TRaw,
  TOut extends { blockNumber: bigint; blockTimestamp: number; chainId: SupportedChainId }
>(opts: IncrementalScanOpts<TRaw, TOut>): Promise<TOut[]> {
  if (!opts.contractAddress || opts.contractAddress === ZERO) return [];

  const client = publicClient(opts.chainId);
  const cacheKey = `${opts.chainId}/${opts.eventKey}`;
  const checkpoint = await readCheckpoint<StoredCheckpoint<TOut>>(cacheKey);

  const latest = await latestBlock(opts.chainId);

  let from: bigint;
  let cached: TOut[] = [];

  if (
    checkpoint &&
    checkpoint.contractAddress === opts.contractAddress.toLowerCase()
  ) {
    from = checkpoint.lastBlock + 1n;
    cached = checkpoint.events;
  } else {
    const range = await getScanRange(opts.chainId, client);
    from = range.from;
  }

  if (from > latest) {
    // No new blocks since last session.
    return cached;
  }

  const raw = await scanLogsReverse(client, from, latest, (s, e) =>
    opts.getLogs(client, s, e)
  );

  const decoded = raw.map((r) => opts.decode(r, opts.chainId));
  const newEvents = (await withBlockTimestamps(client, decoded)) as TOut[];

  const merged = [...newEvents, ...cached]
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, MAX_EVENTS_PER_SOURCE);

  await writeCheckpoint<StoredCheckpoint<TOut>>(cacheKey, {
    contractAddress: opts.contractAddress.toLowerCase(),
    lastBlock: latest,
    events: merged,
    updatedAt: Date.now(),
  });

  return merged;
}
