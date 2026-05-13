/**
 * Etherscan-family API client. Used to fetch native-ETH tx history for the
 * relayer EOA, since native transfers don't emit logs (so eth_getLogs can't
 * find them).
 *
 * Etherscan V2 (Sep 2024) unified the API — a single ETHERSCAN_API_KEY now
 * authenticates against Etherscan, BaseScan, AND Arbiscan across mainnet
 * and testnets. Per-explorer overrides (BASESCAN_API_KEY / ARBISCAN_API_KEY)
 * are still supported if you ever want different keys per chain.
 *
 * Without any key: the function returns null and the relayer-outflow panel
 * shows "API key not configured" instead of crashing.
 */
import { SUPPORTED_CHAINS, type SupportedChainId, CHAIN_IDS } from "./rpc";
import { ADDRESSES } from "./addresses";
import { cached } from "./cache";

const EXPLORER_API: Record<SupportedChainId, { base: string; perChainEnv: string }> = {
  [CHAIN_IDS.BASE_SEPOLIA]: {
    base: "https://api-sepolia.basescan.org/api",
    perChainEnv: "BASESCAN_API_KEY",
  },
  [CHAIN_IDS.ETH_SEPOLIA]: {
    base: "https://api-sepolia.etherscan.io/api",
    perChainEnv: "ETHERSCAN_API_KEY", // same env as the universal fallback
  },
  [CHAIN_IDS.ARB_SEPOLIA]: {
    base: "https://api-sepolia.arbiscan.io/api",
    perChainEnv: "ARBISCAN_API_KEY",
  },
};

/** Resolve the API key: per-chain env if set, else universal ETHERSCAN_API_KEY. */
function resolveKey(chainId: SupportedChainId): string | null {
  const cfg = EXPLORER_API[chainId];
  return (
    process.env[cfg.perChainEnv]?.trim() ||
    process.env.ETHERSCAN_API_KEY?.trim() ||
    null
  );
}

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
  const cfg = EXPLORER_API[chainId];
  const apiKey = resolveKey(chainId);
  if (!apiKey) return null;

  const url = `${cfg.base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc&apikey=${apiKey}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { status: string; message: string; result: ExplorerTx[] | string };
    // Etherscan returns status="0" with message "No transactions found" when empty
    if (data.status === "0" && Array.isArray(data.result)) return [];
    if (data.status !== "1") return null;
    return data.result as ExplorerTx[];
  } catch (err) {
    console.warn(`explorerApi.fetchTxList(${chainId}, ${address}) failed:`, (err as Error).message);
    return null;
  }
}

export type RelayerCashFlow = {
  chainId: SupportedChainId;
  /** Has the explorer API key been configured for this chain? */
  available: boolean;
  /** Native ETH sent FROM the relayer (to stealths and elsewhere), wei. */
  outflow: bigint;
  /** Native ETH received BY the relayer (dust returns + replenishments), wei. */
  inflow: bigint;
  /** Net spent: outflow − inflow. Negative would mean replenished more than spent. */
  netSpent: bigint;
  outflowTxCount: number;
  inflowTxCount: number;
};

export async function getRelayerCashFlow(chainId: SupportedChainId): Promise<RelayerCashFlow> {
  return cached(`relayerCashFlow:${chainId}`, 300, async () => {
    const relayer = ADDRESSES[chainId].relayerWallet.toLowerCase();
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
      };
    }
    let outflow = 0n;
    let inflow = 0n;
    let outCount = 0;
    let inCount = 0;
    for (const tx of txs) {
      const value = BigInt(tx.value || "0");
      if (value === 0n) continue;
      if (tx.from.toLowerCase() === relayer) {
        outflow += value;
        outCount += 1;
      } else if (tx.to.toLowerCase() === relayer) {
        inflow += value;
        inCount += 1;
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
    };
  });
}

export async function getAllRelayerCashFlows(): Promise<RelayerCashFlow[]> {
  return Promise.all(SUPPORTED_CHAINS.map((c) => getRelayerCashFlow(c)));
}
