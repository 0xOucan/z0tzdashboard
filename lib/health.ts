/**
 * Per-chain liveness check: latest block + age + RPC reachability.
 */
import { publicClient } from "./chains";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./rpc";
import { cached } from "./cache";

export type ChainHealth = {
  chainId: SupportedChainId;
  ok: boolean;
  latestBlock: bigint;
  blockTimestamp: number;
  ageSeconds: number;
  error?: string;
};

export async function getChainHealth(): Promise<ChainHealth[]> {
  return cached("chainHealth", 20, async () => {
    const out: ChainHealth[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        try {
          const client = publicClient(chainId);
          const block = await client.getBlock({ blockTag: "latest" });
          const now = Math.floor(Date.now() / 1000);
          out.push({
            chainId,
            ok: true,
            latestBlock: block.number ?? 0n,
            blockTimestamp: Number(block.timestamp),
            ageSeconds: now - Number(block.timestamp),
          });
        } catch (err) {
          out.push({
            chainId,
            ok: false,
            latestBlock: 0n,
            blockTimestamp: 0,
            ageSeconds: 0,
            error: (err as Error).message,
          });
        }
      })
    );
    return out.sort((a, b) => SUPPORTED_CHAINS.indexOf(a.chainId) - SUPPORTED_CHAINS.indexOf(b.chainId));
  });
}
