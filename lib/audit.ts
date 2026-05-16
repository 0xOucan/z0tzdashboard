/**
 * Cross-correlate the relayer's outflow destinations against on-chain Z0tz
 * activity. Each address the relayer funded gets classified by what it
 * subsequently did:
 *
 *   "cashin"  — appeared as PrivateSweep.stealthAddress (sweeper event)
 *   "bridge"  — appeared as CCTP DepositForBurn.depositor
 *   "defi"    — appeared in Tezcatli vault deposits/withdrawals
 *   "unknown" — funded but no observable downstream Z0tz activity
 *
 * "unknown" addresses are the operator's signal to investigate — could be
 * legitimate but unscanned (e.g. an ephemeral stealth that did one CCTP burn
 * the dashboard hasn't indexed), or it could be money walking out the door.
 */
import type { Address } from "viem";
import type { SupportedChainId } from "./rpc";
import { getRelayerCashFlow, type DestinationFlow } from "./explorerApi";
import { getSweepEvents, getCctpBurns } from "./events";
import { getTezcatliParticipantAddresses } from "./tezcatli";
import { EXCLUDED_DESTINATIONS } from "./excluded-destinations";

export type DestinationCategory =
  | "cashin"
  | "bridge"
  | "defi"
  | "excluded"
  | "unknown";

export type ClassifiedDestination = DestinationFlow & {
  chainId: SupportedChainId;
  category: DestinationCategory;
};

export type RelayerAudit = {
  chainId: SupportedChainId;
  available: boolean;
  totalDestinations: number;
  categories: Record<DestinationCategory, number>;
  /** Net ETH (wei) sent per category. */
  netByCategory: Record<DestinationCategory, bigint>;
  destinations: ClassifiedDestination[];
};

export async function auditRelayerForChain(chainId: SupportedChainId): Promise<RelayerAudit> {
  const [flow, sweeps, cctp, defiParticipants] = await Promise.all([
    getRelayerCashFlow(chainId),
    getSweepEvents(chainId),
    getCctpBurns(chainId),
    getTezcatliParticipantAddresses(chainId),
  ]);

  if (!flow.available) {
    return {
      chainId,
      available: false,
      totalDestinations: 0,
      categories: { cashin: 0, bridge: 0, defi: 0, excluded: 0, unknown: 0 },
      netByCategory: {
        cashin: 0n,
        bridge: 0n,
        defi: 0n,
        excluded: 0n,
        unknown: 0n,
      },
      destinations: [],
    };
  }

  const excludedAddrs = EXCLUDED_DESTINATIONS[chainId] ?? new Set<string>();

  // Build lowercase address sets from each Z0tz event source.
  const cashinAddrs = new Set(
    sweeps.map((s) => (s.stealthAddress as string).toLowerCase())
  );
  const bridgeAddrs = new Set(
    cctp.map((c) => (c.depositor as string).toLowerCase())
  );
  // DeFi: addresses seen as `sender` on TezcatliVault.DepositRecorded OR
  // `owner` on WithdrawalExecuted. These are the DeFi stealths the relayer
  // funded so they could sign a vault deposit/withdraw.
  const defiAddrs = defiParticipants;

  const classified: ClassifiedDestination[] = flow.destinations.map((d) => {
    const lc = d.address.toLowerCase();
    let category: DestinationCategory = "unknown";
    // Order matters: excluded wins over everything because the user has
    // explicitly tagged the address as non-cost. cashin > bridge > defi is
    // mostly cosmetic — an address shouldn't appear in more than one.
    if (excludedAddrs.has(lc)) category = "excluded";
    else if (cashinAddrs.has(lc)) category = "cashin";
    else if (bridgeAddrs.has(lc)) category = "bridge";
    else if (defiAddrs.has(lc)) category = "defi";
    return { ...d, chainId, category };
  });

  const categories: Record<DestinationCategory, number> = {
    cashin: 0,
    bridge: 0,
    defi: 0,
    excluded: 0,
    unknown: 0,
  };
  const netByCategory: Record<DestinationCategory, bigint> = {
    cashin: 0n,
    bridge: 0n,
    defi: 0n,
    excluded: 0n,
    unknown: 0n,
  };
  for (const d of classified) {
    categories[d.category] += 1;
    netByCategory[d.category] += d.netSpent;
  }

  return {
    chainId,
    available: true,
    totalDestinations: classified.length,
    categories,
    netByCategory,
    destinations: classified,
  };
}

export async function auditAllChains(
  chains: SupportedChainId[]
): Promise<RelayerAudit[]> {
  return Promise.all(chains.map((c) => auditRelayerForChain(c)));
}
