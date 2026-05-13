import { createPublicClient, type PublicClient } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { CHAIN_IDS, SUPPORTED_CHAINS, makeTransport, type SupportedChainId } from "./rpc";

const VIEM_CHAINS = {
  [CHAIN_IDS.BASE_SEPOLIA]: baseSepolia,
  [CHAIN_IDS.ETH_SEPOLIA]: sepolia,
  [CHAIN_IDS.ARB_SEPOLIA]: arbitrumSepolia,
} as const;

// `createPublicClient` returns a chain-specialized client whose generic
// parameters carry the chain's transaction-format type. The cache Map uses
// the bare `PublicClient` alias, which doesn't structurally match the
// specialized return without an explicit cast — TS rejects the assignment
// otherwise. Functionally identical at runtime; the cast just collapses the
// generics so the cache can hold any chain's client.
const clientCache = new Map<SupportedChainId, PublicClient>();

export function publicClient(chainId: SupportedChainId): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;
  const client = createPublicClient({
    chain: VIEM_CHAINS[chainId],
    transport: makeTransport(chainId),
    batch: { multicall: true },
  }) as PublicClient;
  clientCache.set(chainId, client);
  return client;
}

export function allClients(): { chainId: SupportedChainId; client: PublicClient }[] {
  return SUPPORTED_CHAINS.map((chainId) => ({ chainId, client: publicClient(chainId) }));
}
