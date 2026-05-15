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

const V2_BASE = "https://api.etherscan.io/v2/api";

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

async function fetchTxList(
  chainId: SupportedChainId,
  address: string
): Promise<ExplorerTx[] | null> {
  const v2Key = process.env.ETHERSCAN_API_KEY?.trim();
  if (v2Key) {
    const url = `${V2_BASE}?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${v2Key}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          status: string;
          message: string;
          result: ExplorerTx[] | string;
        };
        if (data.status === "1" && Array.isArray(data.result)) return data.result;
        if (data.status === "0" && Array.isArray(data.result)) return [];
        // status=0 with string result ("Invalid API Key", "Max rate limit reached", etc.)
        console.warn(
          `explorerApi V2 rejected for chain ${chainId}: ${data.message ?? "unknown"}; result=${
            typeof data.result === "string" ? data.result : JSON.stringify(data.result).slice(0, 80)
          }`
        );
      } else {
        console.warn(`explorerApi V2 HTTP ${res.status} for chain ${chainId}`);
      }
    } catch (err) {
      console.warn(`explorerApi V2 fetch failed for chain ${chainId}:`, (err as Error).message);
    }
    // V2 attempted but failed — only fall through to v1 if a per-chain key
    // is explicitly set (otherwise we'd just bombard another endpoint with
    // the same likely-bad key).
  }

  const v1cfg = V1_FALLBACK[chainId];
  const v1Key = process.env[v1cfg.perChainEnv]?.trim();
  if (!v1Key) return null;

  const url = `${v1cfg.base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${v1Key}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { status: string; message: string; result: ExplorerTx[] | string };
    if (data.status === "0" && Array.isArray(data.result)) return [];
    if (data.status !== "1") return null;
    return data.result as ExplorerTx[];
  } catch (err) {
    console.warn(`explorerApi V1 fetch failed for chain ${chainId}:`, (err as Error).message);
    return null;
  }
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

    const txs = await fetchTxList(chainId, relayer);
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
