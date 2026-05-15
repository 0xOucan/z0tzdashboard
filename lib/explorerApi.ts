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

/**
 * Etherscan V2 free tier caps at 3 requests/sec. With all 3 chains firing
 * fetchTxList in parallel on a cold start, we trivially blow that. This
 * lightweight in-process rate limiter enforces a minimum gap between V2
 * calls so we hit ~2.5 req/sec safely under the limit.
 */
let lastV2CallTs = 0;
const V2_MIN_GAP_MS = 400;
async function waitForV2Slot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastV2CallTs;
  if (elapsed < V2_MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, V2_MIN_GAP_MS - elapsed));
  }
  lastV2CallTs = Date.now();
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

async function fetchTxList(
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

  // ── Disk-cache fast path ───────────────────────────────────────────
  // If we have a recent successful tx-list on disk, skip the API entirely.
  // This is what protects us from Etherscan's 3-req/sec free-tier cap
  // when multiple Vercel function instances cold-start near-simultaneously.
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
    await waitForV2Slot();
    const url = `${V2_BASE}?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${v2Key}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          status: string;
          message: string;
          result: ExplorerTx[] | string;
        };
        if (data.status === "1" && Array.isArray(data.result)) txs = data.result;
        else if (data.status === "0" && Array.isArray(data.result)) txs = [];
        else {
          rejection = `V2 status=${data.status} message=${data.message ?? "unknown"} result=${
            typeof data.result === "string" ? data.result : "[]"
          }`;
          console.warn(`explorerApi chain ${chainId}: ${rejection}`);
        }
      } else {
        rejection = `V2 HTTP ${res.status}`;
        console.warn(`explorerApi chain ${chainId}: ${rejection}`);
      }
    } catch (err) {
      rejection = `V2 fetch threw: ${(err as Error).message}`;
      console.warn(`explorerApi chain ${chainId}: ${rejection}`);
    }
  }

  // V1 per-chain fallback if V2 didn't yield results AND a per-chain key exists.
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

  // Successful fetch — persist before filtering so the next cold instance
  // can apply the (possibly updated) deployment-block filter on its own.
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
