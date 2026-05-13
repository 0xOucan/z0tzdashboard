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

const RPC_POOLS: Record<number, string[]> = {
  [CHAIN_IDS.BASE_SEPOLIA]: [
    "https://sepolia.base.org",
    "https://base-sepolia.drpc.org",
    "https://base-sepolia.gateway.tenderly.co",
    "https://rpc.sentio.xyz/base-sepolia",
    "https://base-sepolia-public.nodies.app",
    "https://base-sepolia-rpc.publicnode.com",
  ],
  [CHAIN_IDS.ETH_SEPOLIA]: [
    "https://rpc.sepolia.ethpandaops.io",
    "https://sepolia.gateway.tenderly.co",
    "https://sepolia.drpc.org",
    "https://rpc.sentio.xyz/sepolia",
    "https://1rpc.io/sepolia",
    "https://eth-sepolia.api.onfinality.io/public",
    "https://ethereum-sepolia-public.nodies.app",
    "https://ethereum-sepolia-rpc.publicnode.com",
  ],
  [CHAIN_IDS.ARB_SEPOLIA]: [
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia.drpc.org",
    "https://arbitrum-sepolia.gateway.tenderly.co",
    "https://api.zan.top/arb-sepolia",
    "https://arbitrum-sepolia-rpc.publicnode.com",
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
  return fallback(
    pool.map((u) => http(u, { timeout: 12_000 })),
    { shouldThrow: () => false, retryCount: 2 }
  );
}
