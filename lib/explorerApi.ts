/**
 * Etherscan V2 unified API client. As of Sep 2024, Etherscan exposes a
 * single endpoint (`https://api.etherscan.io/v2/api?chainid=<id>&...`) that
 * authenticates ONE key against every Etherscan-family chain (Ethereum,
 * Base, Arbitrum, etc.) on both mainnet and Sepolia. We hit that endpoint
 * first.
 *
 * Per-chain v1 fallback (`api-sepolia.basescan.org/api`, etc.) only fires
 * if a per-chain key is explicitly set (BASESCAN_API_KEY / ARBISCAN_API_KEY).
 * That path requires the matching native key — basescan.org rejects an
 * etherscan.io v1 key.
 *
 * Without any key the function returns null and the relayer-outflow panel
 * shows "API key not configured" instead of crashing.
 */
import { SUPPORTED_CHAINS, type SupportedChainId, CHAIN_IDS } from "./rpc";
import { ADDRESSES } from "./addresses";
import { cached } from "./cache";
import { readCheckpoint, writeCheckpoint } from "./persistent-cache";
import { deploymentBlock } from "./deployment";
import { waitForEtherscanSlot } from "./etherscanRateLimit";
import * as turso from "./turso";
import { latestBlock } from "./scanner";

/**
 * Disk-cache the raw explorer API response for 1 hour per (chain, address).
 * Etherscan V2 free tier caps at 3 req/sec; with multiple Vercel function
 * instances spinning up, the in-memory cache + in-process rate limiter
 * isn't enough — every new cold instance independently re-fetches. The
 * disk cache means most invocations never even touch the API.
 */
const DISK_CACHE_TTL_MS = 3600_000; // 1 hour
type DiskCachedFetch = {
  fetchedAt: number;
  source: "v2" | "v1";
  txs: ExplorerTx[];
};

const V2_BASE = "https://api.etherscan.io/v2/api";

type EtherscanResponse = {
  status: string;
  message: string;
  result: unknown;
};

/**
 * Etherscan V2 fetch with rate-limit retry. Returns the parsed JSON body
 * or null on hard failure. On a `Max calls per sec` response, retries up
 * to `maxRetries` times with exponential backoff + jitter to avoid
 * thundering-herd from racing function instances.
 */
async function fetchEtherscanV2(
  url: string,
  maxRetries: number = 3
): Promise<EtherscanResponse | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter so racing instances don't re-collide.
      const base = 700 * Math.pow(2, attempt - 1); // 700, 1400, 2800 ms
      const jitter = Math.random() * 400;
      await new Promise((r) => setTimeout(r, base + jitter));
    }
    await waitForEtherscanSlot();
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as EtherscanResponse;
      const result = typeof data.result === "string" ? data.result : "";
      const isRateLimited =
        data.status === "0" && result.toLowerCase().includes("rate limit");
      if (isRateLimited && attempt < maxRetries) {
        // Try again after backoff.
        continue;
      }
      return data;
    } catch {
      if (attempt === maxRetries) return null;
    }
  }
  return null;
}

const V1_FALLBACK: Record<SupportedChainId, { base: string; perChainEnv: string }> = {
  [CHAIN_IDS.BASE_SEPOLIA]: {
    base: "https://api-sepolia.basescan.org/api",
    perChainEnv: "BASESCAN_API_KEY",
  },
  [CHAIN_IDS.ETH_SEPOLIA]: {
    base: "https://api-sepolia.etherscan.io/api",
    perChainEnv: "ETHERSCAN_V1_API_KEY",
  },
  [CHAIN_IDS.ARB_SEPOLIA]: {
    base: "https://api-sepolia.arbiscan.io/api",
    perChainEnv: "ARBISCAN_API_KEY",
  },
};

type ExplorerTx = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  isError: "0" | "1";
};

/**
 * Diagnostic about how the explorer-API call landed for a chain. Surfaced on
 * /gas so when numbers look wrong we can see WHERE in the pipeline data was
 * lost (API rejected? filter too aggressive? no txs at all?).
 */
export type ExplorerMeta = {
  totalTxs: number;
  postDeployTxs: number;
  deploymentBlock: bigint | null;
  source: "v2" | "v1" | "none";
  rejection?: string;
};

/**
 * How often to re-poll Etherscan for new txs per (chain, address). Within
 * this window we serve straight from the Turso `txs` table without touching
 * Etherscan at all. 5 min is enough to look "live" while keeping API usage
 * tiny — each refresh asks for blocks AFTER our cursor, usually returning
 * 0-50 rows vs the full 1153 we'd otherwise refetch.
 */
const TURSO_SYNC_TTL_MS = 5 * 60 * 1000;

async function fetchTxList(
  chainId: SupportedChainId,
  address: string
): Promise<{ txs: ExplorerTx[] | null; meta: ExplorerMeta }> {
  // Turso-backed incremental sync — preferred path. If Turso isn't
  // configured, fall through to the legacy /tmp blob cache below.
  if (turso.isEnabled()) {
    try {
      return await fetchTxListIncremental(chainId, address);
    } catch (err) {
      console.warn(
        `explorerApi chain ${chainId}: Turso sync failed (${(err as Error).message}), falling back to blob cache`
      );
    }
  }
  return fetchTxListLegacy(chainId, address);
}

/**
 * Turso path: query DB, sync only the delta from Etherscan since the last
 * scan cursor, return the union. After the initial backfill this hits
 * Etherscan once per 5min per (chain, address) for a near-empty response
 * — the rate limit becomes a non-issue.
 */
async function fetchTxListIncremental(
  chainId: SupportedChainId,
  address: string
): Promise<{ txs: ExplorerTx[] | null; meta: ExplorerMeta }> {
  const addr = address.toLowerCase();
  const v2Key = process.env.ETHERSCAN_API_KEY?.trim();

  const [state, deployFrom] = await Promise.all([
    turso.getScanState(chainId, addr),
    deploymentBlock(chainId),
  ]);

  const now = Date.now();
  const isStale = !state || now - state.lastFetchedAt > TURSO_SYNC_TTL_MS;
  // Floor scans at the deployment block so we don't backfill irrelevant
  // pre-V6.5 history. If deployment lookup fails, start from 0.
  const deployFloor = deployFrom !== null ? Number(deployFrom) : 0;
  const cursor = Math.max(state?.lastBlockScanned ?? 0, deployFloor);

  let rejection: string | undefined;
  let source: "v2" | "v1" | "none" = state ? "v2" : "none";

  if (isStale && v2Key) {
    source = "v2";
    const url = `${V2_BASE}?chainid=${chainId}&module=account&action=txlist&address=${addr}&startblock=${cursor + 1}&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${v2Key}`;
    const data = await fetchEtherscanV2(url);

    let newTxs: ExplorerTx[] = [];
    if (data === null) {
      rejection = "V2 hard failure (HTTP error or fetch threw after retries)";
      console.warn(`explorerApi chain ${chainId}: ${rejection}`);
    } else if (data.status === "1" && Array.isArray(data.result)) {
      newTxs = data.result as ExplorerTx[];
    } else if (data.status === "0" && Array.isArray(data.result)) {
      // "No transactions found" — empty result, but a clean response.
      newTxs = [];
    } else {
      rejection = `V2 status=${data.status} message=${data.message ?? "unknown"} result=${
        typeof data.result === "string" ? data.result : "[]"
      }`;
      console.warn(`explorerApi chain ${chainId}: ${rejection}`);
    }

    if (rejection === undefined) {
      // Persist new txs and advance the cursor to the current chain head.
      // Using the chain head (not max(newTx.block)) so the next sync's
      // startblock skips the empty range past our last activity.
      if (newTxs.length > 0) {
        await turso.insertTxs(
          chainId,
          newTxs.map((tx) => ({
            hash: tx.hash,
            blockNumber: Number(tx.blockNumber),
            blockTimestamp: Number(tx.timeStamp),
            fromAddr: tx.from,
            toAddr: tx.to || null,
            valueWei: tx.value,
            gasUsed: Number(tx.gasUsed) || 0,
            gasPrice: tx.gasPrice,
            isError: tx.isError === "1",
          }))
        );
      }
      let head: number | null;
      try {
        head = Number(await latestBlock(chainId));
      } catch {
        head = null;
      }
      // Cursor-advance policy — order matters:
      //   1. RPC head succeeded  → advance to head (best: skips empty trailing range)
      //   2. We got new txs      → advance to max(newTx.block) so next sync's
      //                            startblock skips the rows we just inserted
      //   3. No head, no txs     → leave state unchanged. Writing cursor=cursor
      //                            (the previous fallback) would mark "still
      //                            need to scan" as "fully scanned" — locks the
      //                            address into a zero-row state until manual
      //                            intervention. Skipping the write lets the
      //                            next call retry immediately.
      let advancedTo: number | null = null;
      if (head !== null) {
        advancedTo = Math.max(cursor, head);
      } else if (newTxs.length > 0) {
        const maxNew = newTxs.reduce((m, t) => Math.max(m, Number(t.blockNumber) || 0), 0);
        if (maxNew > cursor) advancedTo = maxNew;
      }
      if (advancedTo !== null) {
        await turso.setScanState(chainId, addr, advancedTo, now);
      }
      console.info(
        `explorerApi chain ${chainId} (turso): synced +${newTxs.length} txs since block ${cursor}, head ${head ?? "rpc-down"}`
      );
    }
  }

  // Read the full view for this address from the DB.
  const dbTxs = await turso.queryTxs(chainId, addr, deployFloor);

  // Translate DbTx → ExplorerTx for the downstream consumers (they expect
  // string-encoded numeric fields from the Etherscan response shape).
  const txs: ExplorerTx[] = dbTxs.map((t) => ({
    hash: t.hash,
    blockNumber: t.blockNumber.toString(),
    timeStamp: t.blockTimestamp.toString(),
    from: t.fromAddr,
    to: t.toAddr ?? "",
    value: t.valueWei,
    gasUsed: t.gasUsed.toString(),
    gasPrice: t.gasPrice,
    isError: t.isError ? "1" : "0",
  }));

  // Couldn't sync AND we have no DB rows? Surface that as a hard failure
  // so the UI shows "—" instead of misleading zeros.
  if (rejection && txs.length === 0 && !state) {
    return {
      txs: null,
      meta: { totalTxs: 0, postDeployTxs: 0, deploymentBlock: deployFrom, source, rejection },
    };
  }

  console.info(
    `explorerApi chain ${chainId} (turso): ${txs.length} txs from DB (deployBlock=${deployFrom ?? "unknown"}, cursor=${cursor})`
  );

  return {
    txs,
    meta: {
      totalTxs: txs.length,
      postDeployTxs: txs.length,
      deploymentBlock: deployFrom,
      source: txs.length > 0 ? source : (rejection ? source : "v2"),
      rejection,
    },
  };
}

/**
 * Legacy path: blob-cache the whole txlist on disk, refetch on stale.
 * Used when Turso isn't configured (local dev or pre-migration deploys).
 */
async function fetchTxListLegacy(
  chainId: SupportedChainId,
  address: string
): Promise<{ txs: ExplorerTx[] | null; meta: ExplorerMeta }> {
  // IMPORTANT: We fetch from startblock=0 (no API-side filter) and apply
  // the deployment-block filter in code further down. Reasons:
  //   1. Arbiscan's `startblock` semantics turned out to be inconsistent
  //      with Etherscan's V2 unified gateway — the same key + chainid
  //      returned empty for arb-sepolia while working for eth + base.
  //   2. Client-side filtering means we always have ground-truth tx
  //      counts to log + fall back on if the deployment-block lookup
  //      itself returned a bogus value.

  const diskKey = `explorer-tx/${chainId}/${address.toLowerCase()}`;
  const disk = await readCheckpoint<DiskCachedFetch>(diskKey);
  if (disk && Date.now() - disk.fetchedAt < DISK_CACHE_TTL_MS) {
    return applyDeployFilter(chainId, disk.txs, disk.source);
  }

  const v2Key = process.env.ETHERSCAN_API_KEY?.trim();
  let txs: ExplorerTx[] | null = null;
  let source: "v2" | "v1" | "none" = "none";
  let rejection: string | undefined;

  if (v2Key) {
    source = "v2";
    const url = `${V2_BASE}?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${v2Key}`;
    const data = await fetchEtherscanV2(url);
    if (data === null) {
      rejection = "V2 hard failure (HTTP error or fetch threw after retries)";
      console.warn(`explorerApi chain ${chainId}: ${rejection}`);
    } else if (data.status === "1" && Array.isArray(data.result)) {
      txs = data.result as ExplorerTx[];
    } else if (data.status === "0" && Array.isArray(data.result)) {
      txs = [];
    } else {
      rejection = `V2 status=${data.status} message=${data.message ?? "unknown"} result=${
        typeof data.result === "string" ? data.result : "[]"
      }`;
      console.warn(`explorerApi chain ${chainId}: ${rejection}`);
    }
  }

  if (txs === null) {
    const v1cfg = V1_FALLBACK[chainId];
    const v1Key = process.env[v1cfg.perChainEnv]?.trim();
    if (v1Key) {
      source = "v1";
      const url = `${v1cfg.base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${v1Key}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as {
            status: string;
            message: string;
            result: ExplorerTx[] | string;
          };
          if (data.status === "0" && Array.isArray(data.result)) txs = [];
          else if (data.status === "1" && Array.isArray(data.result))
            txs = data.result as ExplorerTx[];
          else {
            rejection = `V1 status=${data.status} message=${data.message}`;
            console.warn(`explorerApi chain ${chainId}: ${rejection}`);
          }
        } else {
          rejection = `V1 HTTP ${res.status}`;
        }
      } catch (err) {
        rejection = `V1 fetch threw: ${(err as Error).message}`;
        console.warn(`explorerApi chain ${chainId}: ${rejection}`);
      }
    }
  }

  if (txs === null) {
    return {
      txs: null,
      meta: { totalTxs: 0, postDeployTxs: 0, deploymentBlock: null, source, rejection },
    };
  }

  void writeCheckpoint<DiskCachedFetch>(diskKey, {
    fetchedAt: Date.now(),
    source: source === "none" ? "v2" : source,
    txs,
  });

  return applyDeployFilter(chainId, txs, source === "none" ? "v2" : source);
}

/**
 * Apply the V6.5 deployment-block floor + build ExplorerMeta. Shared by
 * the live-fetch and disk-cache-hit paths so we get consistent filtering.
 */
async function applyDeployFilter(
  chainId: SupportedChainId,
  txs: ExplorerTx[],
  source: "v2" | "v1"
): Promise<{ txs: ExplorerTx[]; meta: ExplorerMeta }> {
  const deployFrom = await deploymentBlock(chainId);
  const maxObservedBlock = txs.reduce((max, tx) => {
    const bn = BigInt(tx.blockNumber || "0");
    return bn > max ? bn : max;
  }, 0n);

  let filtered = txs;
  if (deployFrom === null) {
    console.warn(`explorerApi chain ${chainId}: deployment block unknown, using all ${txs.length} txs`);
  } else if (maxObservedBlock > 0n && deployFrom > maxObservedBlock) {
    console.warn(
      `explorerApi chain ${chainId}: deploymentBlock ${deployFrom} > newest tx block ${maxObservedBlock}; filter would zero everything, skipping`
    );
  } else {
    filtered = txs.filter((tx) => BigInt(tx.blockNumber || "0") >= deployFrom);
  }
  console.info(
    `explorerApi chain ${chainId} (${source}): ${txs.length} total · ${filtered.length} post-V6.5 (deployBlock=${deployFrom ?? "unknown"})`
  );

  return {
    txs: filtered,
    meta: {
      totalTxs: txs.length,
      postDeployTxs: filtered.length,
      deploymentBlock: deployFrom,
      source,
    },
  };
}

export type DestinationFlow = {
  /** Recipient address (lowercased). */
  address: `0x${string}`;
  outflow: bigint;
  inflow: bigint;
  netSpent: bigint;
  outflowTxCount: number;
  inflowTxCount: number;
};

export type RelayerCashFlow = {
  chainId: SupportedChainId;
  /** Has any explorer API key been configured AND accepted for this chain? */
  available: boolean;
  /** Total native ETH sent FROM the relayer, all destinations, wei. */
  outflow: bigint;
  /** Total native ETH received BY the relayer (dust returns + replenishments), wei. */
  inflow: bigint;
  netSpent: bigint;
  outflowTxCount: number;
  inflowTxCount: number;
  /** Per-destination breakdown — unique addresses on the other side. */
  destinations: DestinationFlow[];
  /** Pipeline diagnostic — see ExplorerMeta. */
  meta: ExplorerMeta;

  // ── Categorized outflows (subsets of outflow) ───────────────────
  /**
   * Relayer → EntryPoint or relayer → Paymaster contract. These are
   * deposit top-ups into the paymaster's gas-sponsoring pool — NOT a
   * realized cost. The cost manifests later as
   * EntryPoint.UserOperationEvent.actualGasCost when the deposit drains.
   * Counting this AND the paymaster gas would double-count.
   */
  paymasterTopUp: bigint;
  paymasterTopUpTxCount: number;
  /**
   * Relayer → addresses that are NOT EntryPoint / paymaster contracts.
   * Mostly stealth funding (cash-in stealths, CCTP burn stealths, DeFi
   * stealths). This IS a real cost, net of dust returns.
   */
  stealthOutflow: bigint;
  /** Inflows from addresses that ALSO received outflows from the relayer (dust returns). */
  dustReturns: bigint;
  /** stealthOutflow − dustReturns. The actual cost the relayer absorbed for stealth gas. */
  stealthNetCost: bigint;
};

export async function getRelayerCashFlow(chainId: SupportedChainId): Promise<RelayerCashFlow> {
  return cached(`relayerCashFlow:${chainId}`, 300, async () => {
    const relayer = ADDRESSES[chainId].relayerWallet.toLowerCase();
    const entryPoint = ADDRESSES[chainId].entryPoint.toLowerCase();
    const paymaster = ADDRESSES[chainId].paymaster.toLowerCase();
    // Set of reserve-transfer destinations — ETH sent here is treasury
    // movement, not realized cost. The paymaster's gas drain shows up
    // separately via EntryPoint.UserOperationEvent.actualGasCost.
    const reserveDestinations = new Set<string>([entryPoint]);
    if (paymaster !== "0x0000000000000000000000000000000000000000") {
      reserveDestinations.add(paymaster);
    }

    const { txs, meta } = await fetchTxList(chainId, relayer);
    if (txs === null) {
      return {
        chainId,
        available: false,
        outflow: 0n,
        inflow: 0n,
        netSpent: 0n,
        outflowTxCount: 0,
        inflowTxCount: 0,
        destinations: [],
        meta,
        paymasterTopUp: 0n,
        paymasterTopUpTxCount: 0,
        stealthOutflow: 0n,
        dustReturns: 0n,
        stealthNetCost: 0n,
      };
    }

    let outflow = 0n;
    let inflow = 0n;
    let outCount = 0;
    let inCount = 0;
    let paymasterTopUp = 0n;
    let paymasterTopUpTxCount = 0;
    let stealthOutflow = 0n;
    const byAddr = new Map<string, DestinationFlow>();

    for (const tx of txs) {
      const value = BigInt(tx.value || "0");
      if (value === 0n) continue;
      const fromLc = tx.from.toLowerCase();
      const toLc = tx.to.toLowerCase();
      if (fromLc === relayer) {
        outflow += value;
        outCount += 1;
        if (reserveDestinations.has(toLc)) {
          paymasterTopUp += value;
          paymasterTopUpTxCount += 1;
        } else {
          stealthOutflow += value;
        }
        const cur = byAddr.get(toLc) ?? {
          address: toLc as `0x${string}`,
          outflow: 0n,
          inflow: 0n,
          netSpent: 0n,
          outflowTxCount: 0,
          inflowTxCount: 0,
        };
        cur.outflow += value;
        cur.outflowTxCount += 1;
        byAddr.set(toLc, cur);
      } else if (toLc === relayer) {
        inflow += value;
        inCount += 1;
        const cur = byAddr.get(fromLc) ?? {
          address: fromLc as `0x${string}`,
          outflow: 0n,
          inflow: 0n,
          netSpent: 0n,
          outflowTxCount: 0,
          inflowTxCount: 0,
        };
        cur.inflow += value;
        cur.inflowTxCount += 1;
        byAddr.set(fromLc, cur);
      }
    }

    const destinations = Array.from(byAddr.values()).map((d) => ({
      ...d,
      netSpent: d.outflow - d.inflow,
    }));

    // Dust returns: inflows that came FROM an address we previously sent
    // ETH to (i.e. a stealth we funded, returning leftover gas).
    // Replenishments from the treasury are external (`from` address has
    // no prior outflow from the relayer to it) and counted separately.
    let dustReturns = 0n;
    for (const d of destinations) {
      if (d.outflow > 0n && d.inflow > 0n) {
        // The address received an outflow AND sent something back. Cap
        // the dust-return component at the outflow so we never claim
        // "negative cost" if a depositor over-refunded.
        dustReturns += d.inflow > d.outflow ? d.outflow : d.inflow;
      }
    }

    return {
      chainId,
      available: true,
      outflow,
      inflow,
      netSpent: outflow - inflow,
      outflowTxCount: outCount,
      inflowTxCount: inCount,
      destinations,
      meta,
      paymasterTopUp,
      paymasterTopUpTxCount,
      stealthOutflow,
      dustReturns,
      stealthNetCost: stealthOutflow > dustReturns ? stealthOutflow - dustReturns : 0n,
    };
  });
}

export async function getAllRelayerCashFlows(): Promise<RelayerCashFlow[]> {
  return Promise.all(SUPPORTED_CHAINS.map((c) => getRelayerCashFlow(c)));
}

// ---------------------------------------------------------------------------
// Treasury / deployer wallet — separate accounting from the relayer EOA.
//
// The treasury wallet (`ADDRESSES[chain].treasury`, same address on every
// chain) is the source of funds that:
//   1. Deployed every Z0tz contract (one-time gas cost per chain)
//   2. Top-up the paymaster's EntryPoint deposit (via depositTo)
//   3. Pays for admin ops (Set Operator, Lock, Set Risk Policy, etc.)
//
// Without this view the dashboard couldn't show "how much has been allocated
// to the paymaster pool" vs "how much has been drained" — only the drain
// side (UserOperationEvent.actualGasCost) was visible.
// ---------------------------------------------------------------------------

export type TreasuryCashFlow = {
  chainId: SupportedChainId;
  available: boolean;
  meta: ExplorerMeta;
  /** ETH sent FROM treasury → EntryPoint (paymaster pool deposits). */
  paymasterFunding: bigint;
  paymasterFundingTxCount: number;
  /** Gas paid for contract creations (tx.to is empty). One-time setup cost. */
  deploymentGas: bigint;
  deploymentTxCount: number;
  /** Gas paid for non-deploy txs (admin ops, transfers, etc.). */
  operationalGas: bigint;
  operationalTxCount: number;
  /** Sum of every tx fee (deploymentGas + operationalGas), wei. */
  totalGasPaid: bigint;
  /** Non-paymaster ETH transfers FROM treasury (excluding gas). */
  otherOutflow: bigint;
  otherOutflowTxCount: number;
  /** ETH received BY treasury (external funding from faucets / multi-sig). */
  inflow: bigint;
  inflowTxCount: number;
};

export async function getTreasuryCashFlow(chainId: SupportedChainId): Promise<TreasuryCashFlow> {
  return cached(`treasuryCashFlow:${chainId}`, 300, async () => {
    const treasury = ADDRESSES[chainId].treasury.toLowerCase();
    const entryPoint = ADDRESSES[chainId].entryPoint.toLowerCase();
    const { txs, meta } = await fetchTxList(chainId, treasury);
    if (txs === null) {
      return {
        chainId,
        available: false,
        meta,
        paymasterFunding: 0n,
        paymasterFundingTxCount: 0,
        deploymentGas: 0n,
        deploymentTxCount: 0,
        operationalGas: 0n,
        operationalTxCount: 0,
        totalGasPaid: 0n,
        otherOutflow: 0n,
        otherOutflowTxCount: 0,
        inflow: 0n,
        inflowTxCount: 0,
      };
    }

    let paymasterFunding = 0n;
    let paymasterFundingTxCount = 0;
    let deploymentGas = 0n;
    let deploymentTxCount = 0;
    let operationalGas = 0n;
    let operationalTxCount = 0;
    let otherOutflow = 0n;
    let otherOutflowTxCount = 0;
    let inflow = 0n;
    let inflowTxCount = 0;

    for (const tx of txs) {
      const value = BigInt(tx.value || "0");
      const gasFee = BigInt(tx.gasUsed || "0") * BigInt(tx.gasPrice || "0");
      const fromLc = tx.from.toLowerCase();
      const toLc = (tx.to || "").toLowerCase();

      if (fromLc === treasury) {
        // Outgoing tx — categorize.
        const isContractCreation = toLc === "" || toLc === "0x0000000000000000000000000000000000000000";
        if (isContractCreation) {
          deploymentGas += gasFee;
          deploymentTxCount += 1;
        } else {
          operationalGas += gasFee;
          operationalTxCount += 1;
        }
        if (toLc === entryPoint && value > 0n) {
          paymasterFunding += value;
          paymasterFundingTxCount += 1;
        } else if (value > 0n) {
          otherOutflow += value;
          otherOutflowTxCount += 1;
        }
      } else if (toLc === treasury && value > 0n) {
        // Incoming external funding.
        inflow += value;
        inflowTxCount += 1;
      }
    }

    return {
      chainId,
      available: true,
      meta,
      paymasterFunding,
      paymasterFundingTxCount,
      deploymentGas,
      deploymentTxCount,
      operationalGas,
      operationalTxCount,
      totalGasPaid: deploymentGas + operationalGas,
      otherOutflow,
      otherOutflowTxCount,
      inflow,
      inflowTxCount,
    };
  });
}

export async function getAllTreasuryCashFlows(): Promise<TreasuryCashFlow[]> {
  return Promise.all(SUPPORTED_CHAINS.map((c) => getTreasuryCashFlow(c)));
}
