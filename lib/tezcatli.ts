/**
 * Tezcatli + compliance + stealth event readers and live state reads.
 * Event scans use lib/incremental.ts → session-persisted across refreshes.
 */
import type { Address } from "viem";
import { publicClient } from "./chains";
import { ADDRESSES } from "./addresses";
import {
  TEZCATLI_VAULT_ABI,
  TEZCATLI_AAVE_ADAPTER_ABI,
  COMPLIANCE_GATE_ABI,
  KYC_REGISTRY_ABI,
  OFAC_ORACLE_ABI,
  STEALTH_ANNOUNCER_ABI,
  DEPOSITOR_REGISTRY_ABI,
  ERC20_ABI,
} from "./abis";
import { cached } from "./cache";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./rpc";
import { incrementalScan } from "./incremental";

const CACHE_TTL = 300; // 5 min — see lib/events.ts for rationale

// Internal event row shape — all incremental scans must return at least these
// fields so withBlockTimestamps / disk serialization line up.
type Row = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
};

// ---------------------------------------------------------------------------
// Tezcatli vault events
// ---------------------------------------------------------------------------

type VaultDepositRow = Row & { sender: Address; beneficiary: Address };
type VaultWithdrawRow = Row & { owner: Address; recipient: Address };
type VaultStrategyDeployRow = Row & { adapter: Address; assets: bigint; sharesOut: bigint };
type VaultStrategyRedeemRow = Row & { adapter: Address; sharesIn: bigint; assetsOut: bigint };

export type TezcatliVaultActivity = {
  chainId: SupportedChainId;
  deposits: number;
  withdrawals: number;
  strategyDeployed: bigint;
  strategyRedeemed: bigint;
  lastActivityTs: number;
};

export async function getTezcatliVaultActivity(): Promise<TezcatliVaultActivity[]> {
  return cached("tezcatliActivity", CACHE_TTL, async () => {
    const out: TezcatliVaultActivity[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId].tezcatliVault;
        if (!addr) {
          out.push({
            chainId,
            deposits: 0,
            withdrawals: 0,
            strategyDeployed: 0n,
            strategyRedeemed: 0n,
            lastActivityTs: 0,
          });
          return;
        }

        const [deposits, withdrawals, strategyDeployed, strategyRedeemed] = await Promise.all([
          incrementalScan<unknown, VaultDepositRow>({
            chainId,
            contractAddress: addr,
            eventKey: "tezcatliVaultDeposit",
            getLogs: (client, from, to) =>
              client.getLogs({
                address: addr,
                event: TEZCATLI_VAULT_ABI[0],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              sender: log.args.sender as Address,
              beneficiary: log.args.beneficiary as Address,
            }),
          }),
          incrementalScan<unknown, VaultWithdrawRow>({
            chainId,
            contractAddress: addr,
            eventKey: "tezcatliVaultWithdraw",
            getLogs: (client, from, to) =>
              client.getLogs({
                address: addr,
                event: TEZCATLI_VAULT_ABI[1],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              owner: log.args.owner as Address,
              recipient: log.args.recipient as Address,
            }),
          }),
          incrementalScan<unknown, VaultStrategyDeployRow>({
            chainId,
            contractAddress: addr,
            eventKey: "tezcatliStrategyDeploy",
            getLogs: (client, from, to) =>
              client.getLogs({
                address: addr,
                event: TEZCATLI_VAULT_ABI[2],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              adapter: log.args.adapter as Address,
              assets: log.args.assets as bigint,
              sharesOut: log.args.sharesOut as bigint,
            }),
          }),
          incrementalScan<unknown, VaultStrategyRedeemRow>({
            chainId,
            contractAddress: addr,
            eventKey: "tezcatliStrategyRedeem",
            getLogs: (client, from, to) =>
              client.getLogs({
                address: addr,
                event: TEZCATLI_VAULT_ABI[3],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              adapter: log.args.adapter as Address,
              sharesIn: log.args.sharesIn as bigint,
              assetsOut: log.args.assetsOut as bigint,
            }),
          }),
        ]);

        const lastActivityTs = Math.max(
          0,
          ...deposits.map((d) => d.blockTimestamp),
          ...withdrawals.map((w) => w.blockTimestamp),
          ...strategyDeployed.map((s) => s.blockTimestamp),
          ...strategyRedeemed.map((s) => s.blockTimestamp)
        );

        out.push({
          chainId,
          deposits: deposits.length,
          withdrawals: withdrawals.length,
          strategyDeployed: strategyDeployed.reduce((acc, e) => acc + e.assets, 0n),
          strategyRedeemed: strategyRedeemed.reduce((acc, e) => acc + e.assetsOut, 0n),
          lastActivityTs,
        });
      })
    );
    return out;
  });
}

// ---------------------------------------------------------------------------
// Aave V3 adapter — live read (no events to cache)
// ---------------------------------------------------------------------------

export type AaveAdapterSnapshot = {
  chainId: SupportedChainId;
  adapter: Address;
  aToken: Address | null;
  aTokenBalance: bigint;
  underlyingInAdapter: bigint;
};

export async function getAaveAdapterSnapshot(): Promise<AaveAdapterSnapshot[]> {
  return cached("aaveAdapter", CACHE_TTL, async () => {
    const out: AaveAdapterSnapshot[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId];
        if (!addr.tezcatliStrategyAdapter) return;
        const client = publicClient(chainId);
        try {
          const aToken = (await client.readContract({
            address: addr.tezcatliStrategyAdapter,
            abi: TEZCATLI_AAVE_ADAPTER_ABI,
            functionName: "aToken",
          })) as Address;
          const [aTokenBalance, underlyingInAdapter] = await Promise.all([
            client.readContract({
              address: aToken,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [addr.tezcatliStrategyAdapter],
            }) as Promise<bigint>,
            client.readContract({
              address: addr.usdc,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [addr.tezcatliStrategyAdapter],
            }) as Promise<bigint>,
          ]);
          out.push({
            chainId,
            adapter: addr.tezcatliStrategyAdapter,
            aToken,
            aTokenBalance,
            underlyingInAdapter,
          });
        } catch (err) {
          console.warn(`aave adapter snapshot ${chainId} failed:`, (err as Error).message);
        }
      })
    );
    return out;
  });
}

// ---------------------------------------------------------------------------
// Compliance gate — live state reads + cached event scans
// ---------------------------------------------------------------------------

type ScreenedRow = Row & {
  account: Address;
  allowed: boolean;
  reasonCode: number;
  amount: bigint;
};
type BlacklistedRow = Row & { account: Address; reasonCode: number };
type WhitelistedRow = Row & { account: Address };

export type ComplianceState = {
  chainId: SupportedChainId;
  enabled: boolean;
  requireKyc: boolean;
  policyVersion: bigint;
  blacklistedCount: number;
  whitelistedCount: number;
  screenedTotal: number;
  screenedDenied: number;
};

export async function getComplianceState(): Promise<ComplianceState[]> {
  return cached("complianceState", CACHE_TTL, async () => {
    const out: ComplianceState[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId].complianceGate;
        if (!addr) return;
        const client = publicClient(chainId);
        try {
          const [enabled, requireKyc, policyVersion, screened, blacklisted, whitelisted] =
            await Promise.all([
              client.readContract({
                address: addr,
                abi: COMPLIANCE_GATE_ABI,
                functionName: "enabled",
              }) as Promise<boolean>,
              client.readContract({
                address: addr,
                abi: COMPLIANCE_GATE_ABI,
                functionName: "requireKyc",
              }) as Promise<boolean>,
              client.readContract({
                address: addr,
                abi: COMPLIANCE_GATE_ABI,
                functionName: "policyVersion",
              }) as Promise<bigint>,
              incrementalScan<unknown, ScreenedRow>({
                chainId,
                contractAddress: addr,
                eventKey: "gateScreened",
                getLogs: (c, from, to) =>
                  c.getLogs({
                    address: addr,
                    event: COMPLIANCE_GATE_ABI[0],
                    fromBlock: from,
                    toBlock: to,
                  }),
                decode: (log: any, chainId) => ({
                  chainId,
                  blockNumber: log.blockNumber,
                  txHash: log.transactionHash,
                  account: log.args.account as Address,
                  allowed: Boolean(log.args.allowed),
                  reasonCode: Number(log.args.reasonCode),
                  amount: log.args.amount as bigint,
                }),
              }),
              incrementalScan<unknown, BlacklistedRow>({
                chainId,
                contractAddress: addr,
                eventKey: "gateBlacklisted",
                getLogs: (c, from, to) =>
                  c.getLogs({
                    address: addr,
                    event: COMPLIANCE_GATE_ABI[1],
                    fromBlock: from,
                    toBlock: to,
                  }),
                decode: (log: any, chainId) => ({
                  chainId,
                  blockNumber: log.blockNumber,
                  txHash: log.transactionHash,
                  account: log.args.account as Address,
                  reasonCode: Number(log.args.reasonCode),
                }),
              }),
              incrementalScan<unknown, WhitelistedRow>({
                chainId,
                contractAddress: addr,
                eventKey: "gateWhitelisted",
                getLogs: (c, from, to) =>
                  c.getLogs({
                    address: addr,
                    event: COMPLIANCE_GATE_ABI[2],
                    fromBlock: from,
                    toBlock: to,
                  }),
                decode: (log: any, chainId) => ({
                  chainId,
                  blockNumber: log.blockNumber,
                  txHash: log.transactionHash,
                  account: log.args.account as Address,
                }),
              }),
            ]);

          out.push({
            chainId,
            enabled,
            requireKyc,
            policyVersion,
            blacklistedCount: blacklisted.length,
            whitelistedCount: whitelisted.length,
            screenedTotal: screened.length,
            screenedDenied: screened.filter((s) => !s.allowed).length,
          });
        } catch (err) {
          console.warn(`compliance state ${chainId} failed:`, (err as Error).message);
        }
      })
    );
    return out;
  });
}

// ---------------------------------------------------------------------------
// KYC registry
// ---------------------------------------------------------------------------

type KycAttestedRow = Row & { account: Address };
type KycRevokedRow = Row & { account: Address };

export type KycCount = {
  chainId: SupportedChainId;
  attestedCount: number;
  revokedCount: number;
  netCount: number;
};

export async function getKycCounts(): Promise<KycCount[]> {
  return cached("kycCounts", CACHE_TTL, async () => {
    const out: KycCount[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId].kycRegistry;
        if (!addr) return;
        const [attested, revoked] = await Promise.all([
          incrementalScan<unknown, KycAttestedRow>({
            chainId,
            contractAddress: addr,
            eventKey: "kycAttested",
            getLogs: (c, from, to) =>
              c.getLogs({
                address: addr,
                event: KYC_REGISTRY_ABI[0],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              account: log.args.account as Address,
            }),
          }),
          incrementalScan<unknown, KycRevokedRow>({
            chainId,
            contractAddress: addr,
            eventKey: "kycRevoked",
            getLogs: (c, from, to) =>
              c.getLogs({
                address: addr,
                event: KYC_REGISTRY_ABI[1],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              account: log.args.account as Address,
            }),
          }),
        ]);
        out.push({
          chainId,
          attestedCount: attested.length,
          revokedCount: revoked.length,
          netCount: attested.length - revoked.length,
        });
      })
    );
    return out;
  });
}

// ---------------------------------------------------------------------------
// OFAC oracle
// ---------------------------------------------------------------------------

type SanctionedRow = Row & { account: Address };
type UnsanctionedRow = Row & { account: Address };

export type OfacCount = {
  chainId: SupportedChainId;
  sanctionedCount: number;
  unsanctionedCount: number;
  netCount: number;
};

export async function getOfacCounts(): Promise<OfacCount[]> {
  return cached("ofacCounts", CACHE_TTL, async () => {
    const out: OfacCount[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId].ofacOracle;
        if (!addr) return;
        const [sanctioned, unsanctioned] = await Promise.all([
          incrementalScan<unknown, SanctionedRow>({
            chainId,
            contractAddress: addr,
            eventKey: "ofacSanctioned",
            getLogs: (c, from, to) =>
              c.getLogs({
                address: addr,
                event: OFAC_ORACLE_ABI[0],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              account: log.args.account as Address,
            }),
          }),
          incrementalScan<unknown, UnsanctionedRow>({
            chainId,
            contractAddress: addr,
            eventKey: "ofacUnsanctioned",
            getLogs: (c, from, to) =>
              c.getLogs({
                address: addr,
                event: OFAC_ORACLE_ABI[1],
                fromBlock: from,
                toBlock: to,
              }),
            decode: (log: any, chainId) => ({
              chainId,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              account: log.args.account as Address,
            }),
          }),
        ]);
        out.push({
          chainId,
          sanctionedCount: sanctioned.length,
          unsanctionedCount: unsanctioned.length,
          netCount: sanctioned.length - unsanctioned.length,
        });
      })
    );
    return out;
  });
}

// ---------------------------------------------------------------------------
// Depositor registry
// ---------------------------------------------------------------------------

type DepositRow = Row & { depositor: Address; asset: Address; amount: bigint };

export type DepositorCount = {
  chainId: SupportedChainId;
  count: number;
  uniqueDepositors: number;
  totalRecorded: bigint;
};

export async function getDepositorCounts(): Promise<DepositorCount[]> {
  return cached("depositorCounts", CACHE_TTL, async () => {
    const out: DepositorCount[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId].depositorRegistry;
        if (!addr) {
          out.push({ chainId, count: 0, uniqueDepositors: 0, totalRecorded: 0n });
          return;
        }
        const rows = await incrementalScan<unknown, DepositRow>({
          chainId,
          contractAddress: addr,
          eventKey: "depositorRecorded",
          getLogs: (c, from, to) =>
            c.getLogs({
              address: addr,
              event: DEPOSITOR_REGISTRY_ABI[0],
              fromBlock: from,
              toBlock: to,
            }),
          decode: (log: any, chainId) => ({
            chainId,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            depositor: log.args.depositor as Address,
            asset: log.args.asset as Address,
            amount: log.args.amount as bigint,
          }),
        });
        const unique = new Set(rows.map((r) => r.depositor));
        const total = rows.reduce((acc, r) => acc + r.amount, 0n);
        out.push({
          chainId,
          count: rows.length,
          uniqueDepositors: unique.size,
          totalRecorded: total,
        });
      })
    );
    return out;
  });
}

// ---------------------------------------------------------------------------
// Stealth announcer
// ---------------------------------------------------------------------------

type AnnouncementRow = Row & { stealthAddress: Address; schemeId: bigint };

export type StealthAnnouncementCount = {
  chainId: SupportedChainId;
  count: number;
};

export async function getStealthAnnouncementCounts(): Promise<StealthAnnouncementCount[]> {
  return cached("stealthAnnouncements", CACHE_TTL, async () => {
    const out: StealthAnnouncementCount[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId].stealthAnnouncer;
        if (!addr) {
          out.push({ chainId, count: 0 });
          return;
        }
        const rows = await incrementalScan<unknown, AnnouncementRow>({
          chainId,
          contractAddress: addr,
          eventKey: "stealthAnnouncement",
          getLogs: (c, from, to) =>
            c.getLogs({
              address: addr,
              event: STEALTH_ANNOUNCER_ABI[0],
              fromBlock: from,
              toBlock: to,
            }),
          decode: (log: any, chainId) => ({
            chainId,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            stealthAddress: log.args.stealthAddress as Address,
            schemeId: log.args.schemeId as bigint,
          }),
        });
        out.push({ chainId, count: rows.length });
      })
    );
    return out;
  });
}
