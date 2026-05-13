import { createPublicClient, type PublicClient } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia } from "viem/chains";
import { CHAIN_IDS, SUPPORTED_CHAINS, makeTransport, type SupportedChainId } from "./rpc";

const VIEM_CHAINS = {
  [CHAIN_IDS.BASE_SEPOLIA]: baseSepolia,
  [CHAIN_IDS.ETH_SEPOLIA]: sepolia,
  [CHAIN_IDS.ARB_SEPOLIA]: arbitrumSepolia,
} as const;

const clientCache = new Map<SupportedChainId, PublicClient>();

export function publicClient(chainId: SupportedChainId): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;
  const client = createPublicClient({
    chain: VIEM_CHAINS[chainId],
    transport: makeTransport(chainId),
    batch: { multicall: true },
  });
  clientCache.set(chainId, client);
  return client;
}

export function allClients(): { chainId: SupportedChainId; client: PublicClient }[] {
  return SUPPORTED_CHAINS.map((chainId) => ({ chainId, client: publicClient(chainId) }));
}
