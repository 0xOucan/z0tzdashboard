/**
 * RPC pool resolution. Mirrors the Z0tz relayer's strategy:
 *   1. If RPC_URL_{chainId} env var is set AND not already in the curated pool,
 *      it becomes the primary. The curated pool follows as fallbacks.
 *   2. Otherwise the curated pool's leading entry is primary.
 *   3. viem's `fallback` transport rotates through the pool on any error.
 *
 * Curated leaders are official chain RPCs (single-backend, consistent nonce
 * reads). Backups are reliable third-party endpoints (drpc, tenderly, sentio).
 */
import { http, fallback, type Transport } from "viem";

export const CHAIN_IDS = {
  BASE_SEPOLIA: 84532,
  ETH_SEPOLIA: 11155111,
  ARB_SEPOLIA: 421614,
} as const;

export type SupportedChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const SUPPORTED_CHAINS: SupportedChainId[] = [
  CHAIN_IDS.BASE_SEPOLIA,
  CHAIN_IDS.ETH_SEPOLIA,
  CHAIN_IDS.ARB_SEPOLIA,
];

export const CHAIN_META: Record<SupportedChainId, { name: string; short: string; color: string }> = {
  [CHAIN_IDS.BASE_SEPOLIA]: { name: "Base Sepolia", short: "base", color: "#0052ff" },
  [CHAIN_IDS.ETH_SEPOLIA]: { name: "Eth Sepolia", short: "eth", color: "#627eea" },
  [CHAIN_IDS.ARB_SEPOLIA]: { name: "Arb Sepolia", short: "arb", color: "#28a0f0" },
};

// Curated pool ordering: official chain RPCs first (lowest latency,
// consistent reads), reliable third-parties next, and drpc demoted because
// its free tier responds with "Request timeout on the free tier, please
// upgrade your tier to the paid one" once we exhaust the per-IP quota.
// Latency notes sourced from chainlist.org 2026-05-16 reading.
const RPC_POOLS: Record<number, string[]> = {
  [CHAIN_IDS.BASE_SEPOLIA]: [
    "https://sepolia.base.org",
    "https://base-sepolia.gateway.tenderly.co",
    "https://base-sepolia.api.onfinality.io/public",
    "https://rpc.sentio.xyz/base-sepolia",
    "https://base-sepolia-public.nodies.app",
    "https://public.stackup.sh/api/v1/node/base-sepolia",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.drpc.org",
  ],
  [CHAIN_IDS.ETH_SEPOLIA]: [
    "https://rpc.sepolia.ethpandaops.io",
    "https://sepolia.gateway.tenderly.co",
    "https://eth-sepolia.api.onfinality.io/public",
    "https://1rpc.io/sepolia",
    "https://eth-sepolia.public.blastapi.io",
    "https://rpc.sentio.xyz/sepolia",
    "https://ethereum-sepolia-public.nodies.app",
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.drpc.org",
  ],
  [CHAIN_IDS.ARB_SEPOLIA]: [
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia.gateway.tenderly.co",
    "https://arbitrum-sepolia.api.onfinality.io/public",
    "https://public.stackup.sh/api/v1/node/arbitrum-sepolia",
    "https://endpoints.omniatech.io/v1/arbitrum/sepolia/public",
    "https://arbitrum-sepolia-rpc.publicnode.com",
    "https://arbitrum-sepolia.drpc.org",
  ],
};

export function resolvePool(chainId: number): string[] {
  const envVal = process.env[`RPC_URL_${chainId}`]?.trim();
  const base = RPC_POOLS[chainId] ?? [];
  if (!envVal || envVal.length === 0) return base;
  if (base.includes(envVal)) return base;
  return [envVal, ...base.filter((u) => u !== envVal)];
}

export function makeTransport(chainId: number): Transport {
  const pool = resolvePool(chainId);
  if (pool.length === 0) {
    throw new Error(`No RPC pool configured for chain ${chainId}`);
  }
  // 8s per-RPC timeout: long enough for a slow but-up node to answer, short
  // enough that the failover to the next URL fires before Vercel's 60s
  // function ceiling burns through on a multi-source scan page.
  return fallback(pool.map((u) => http(u, { timeout: 8_000 })), { retryCount: 1 });
}
