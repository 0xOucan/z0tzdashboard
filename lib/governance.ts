/**
 * Governance / admin / security event scanner. Captures the events that
 * AREN'T part of normal user flow but signal something an operator must
 * watch: recovery in progress, paymaster operator changes, sweeper legacy
 * path toggled, ledger locked, compliance gate flipped, vault admin actions.
 *
 * Severity buckets:
 *   "critical" — security or rollback-risk events. Surface on /health.
 *   "warn"     — operational changes worth a log line.
 *   "info"     — informational changes (fee tweaks, target approvals).
 */
import type { Address, PublicClient } from "viem";
import { publicClient } from "./chains";
import { ADDRESSES } from "./addresses";
import {
  RECOVERY_MODULE_ABI,
  PAYMASTER_ADMIN_ABI,
  SWEEPER_ADMIN_ABI,
  LEDGER_LOCK_ABI,
  TEZCATLI_VAULT_ADMIN_ABI,
  COMPLIANCE_GATE_ABI,
} from "./abis";
import { cached } from "./cache";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./rpc";
import { getScanRange, scanLogsReverse, withBlockTimestamps } from "./scanner";

const CACHE_TTL = 60;

export type GovSeverity = "critical" | "warn" | "info";

export type GovEvent = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
  contract: Address;
  /** Where the event came from — for grouping in the UI. */
  source:
    | "RecoveryModule"
    | "Paymaster"
    | "Sweeper"
    | "Ledger"
    | "TezcatliVault"
    | "ComplianceGate";
  /** Event name as emitted on chain. */
  name: string;
  severity: GovSeverity;
  /** Human-readable summary for the timeline. */
  summary: string;
  /** Raw event args for detail panels. */
  args: Record<string, string | number | boolean>;
};

async function scanContractEvents<TLogArgs extends Record<string, unknown>>(
  client: PublicClient,
  address: Address,
  eventAbi: any,
  from: bigint,
  to: bigint
): Promise<Array<{ blockNumber: bigint; transactionHash: `0x${string}`; args: TLogArgs }>> {
  const raw = await scanLogsReverse(client, from, to, (s, e) =>
    client.getLogs({ address, event: eventAbi, fromBlock: s, toBlock: e })
  );
  return raw.map((log: any) => ({
    blockNumber: log.blockNumber as bigint,
    transactionHash: log.transactionHash as `0x${string}`,
    args: log.args as TLogArgs,
  }));
}

function short(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function scanGovernance(): Promise<GovEvent[]> {
  return cached("governanceEvents", CACHE_TTL, async () => {
    const events: GovEvent[] = [];

    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId];
        const client = publicClient(chainId);
        const { from, to } = await getScanRange(chainId, client);

        // ── Recovery module (per-account proxy implementation). The
        //    deployed implementation is the canonical contract; per-account
        //    proxies forward events to the impl logs. We scan the impl.
        const recoveryAddr = addr.recoveryModuleImpl;
        const recoveryTasks = recoveryAddr
          ? [
              scanContractEvents(client, recoveryAddr, RECOVERY_MODULE_ABI[0], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "RecoveryModule" as const,
                  contract: recoveryAddr,
                  name: "RecoveryInitiated",
                  severity: "critical" as const,
                  summary: `Recovery started for account ${short(l.args.account as string)} — executes after ${new Date(Number(l.args.executeAfter as bigint) * 1000).toISOString()}`,
                  args: {
                    account: l.args.account as string,
                    executeAfter: (l.args.executeAfter as bigint).toString(),
                  },
                }))
              ),
              scanContractEvents(client, recoveryAddr, RECOVERY_MODULE_ABI[1], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "RecoveryModule" as const,
                  contract: recoveryAddr,
                  name: "RecoveryFinalized",
                  severity: "warn" as const,
                  summary: `Recovery FINALIZED on ${short(l.args.account as string)} (epoch ${(l.args.epoch as bigint).toString()}) — new owner active`,
                  args: { account: l.args.account as string, epoch: (l.args.epoch as bigint).toString() },
                }))
              ),
              scanContractEvents(client, recoveryAddr, RECOVERY_MODULE_ABI[2], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "RecoveryModule" as const,
                  contract: recoveryAddr,
                  name: "RecoveryCancelled",
                  severity: "info" as const,
                  summary: `Recovery cancelled on ${short(l.args.account as string)}`,
                  args: { account: l.args.account as string },
                }))
              ),
              scanContractEvents(client, recoveryAddr, RECOVERY_MODULE_ABI[3], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "RecoveryModule" as const,
                  contract: recoveryAddr,
                  name: "GuardiansRotated",
                  severity: "info" as const,
                  summary: `Guardians rotated on ${short(l.args.account as string)} (epoch ${(l.args.epoch as bigint).toString()})`,
                  args: { account: l.args.account as string, epoch: (l.args.epoch as bigint).toString() },
                }))
              ),
            ]
          : [];

        // ── Paymaster admin events
        const paymaster = addr.paymaster;
        const paymasterTasks =
          paymaster !== "0x0000000000000000000000000000000000000000"
            ? [
                scanContractEvents(client, paymaster, PAYMASTER_ADMIN_ABI[0], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Paymaster" as const,
                    contract: paymaster,
                    name: "ConfigUpdated",
                    severity: "warn" as const,
                    summary: `Paymaster config updated — feeRateBps=${(l.args.feeRateBps as bigint).toString()}, maxFeeCap=${(l.args.maxFeeCap as bigint).toString()}`,
                    args: {
                      feeRateBps: (l.args.feeRateBps as bigint).toString(),
                      maxFeeCap: (l.args.maxFeeCap as bigint).toString(),
                    },
                  }))
                ),
                scanContractEvents(client, paymaster, PAYMASTER_ADMIN_ABI[1], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Paymaster" as const,
                    contract: paymaster,
                    name: "TreasuryUpdated",
                    severity: "critical" as const,
                    summary: `Paymaster treasury rotated → ${short(l.args.treasury as string)}`,
                    args: { treasury: l.args.treasury as string },
                  }))
                ),
                scanContractEvents(client, paymaster, PAYMASTER_ADMIN_ABI[2], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Paymaster" as const,
                    contract: paymaster,
                    name: "OperatorUpdated",
                    severity: "critical" as const,
                    summary: `Paymaster operator rotated → ${short(l.args.operator as string)}`,
                    args: { operator: l.args.operator as string },
                  }))
                ),
                scanContractEvents(client, paymaster, PAYMASTER_ADMIN_ABI[3], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Paymaster" as const,
                    contract: paymaster,
                    name: "WhitelistEnabledSet",
                    severity: "warn" as const,
                    summary: `Paymaster whitelist ${l.args.enabled ? "ENABLED" : "disabled"}`,
                    args: { enabled: Boolean(l.args.enabled) },
                  }))
                ),
              ]
            : [];

        // ── Sweeper admin events
        const sweeper = addr.sweeper;
        const sweeperTasks =
          sweeper !== "0x0000000000000000000000000000000000000000"
            ? [
                scanContractEvents(client, sweeper, SWEEPER_ADMIN_ABI[0], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Sweeper" as const,
                    contract: sweeper,
                    name: "TreasurySet",
                    severity: "critical" as const,
                    summary: `Sweeper treasury rotated → ${short(l.args.treasury as string)}`,
                    args: { treasury: l.args.treasury as string },
                  }))
                ),
                scanContractEvents(client, sweeper, SWEEPER_ADMIN_ABI[1], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Sweeper" as const,
                    contract: sweeper,
                    name: "LegacyEnabledSet",
                    severity: l.args.enabled ? ("critical" as const) : ("warn" as const),
                    summary: l.args.enabled
                      ? `⚠ Sweeper V1 LEGACY PATH ENABLED — known C-1 attack surface re-opened`
                      : `Sweeper V1 legacy path disabled`,
                    args: { enabled: Boolean(l.args.enabled) },
                  }))
                ),
              ]
            : [];

        // ── Ledger Locked
        const ledger = addr.ledger;
        const ledgerTasks =
          ledger !== "0x0000000000000000000000000000000000000000"
            ? [
                scanContractEvents(client, ledger, LEDGER_LOCK_ABI[0], from, to).then((logs) =>
                  logs.map((l) => ({
                    ...l,
                    source: "Ledger" as const,
                    contract: ledger,
                    name: "Locked",
                    severity: "critical" as const,
                    summary: "Ledger LOCKED — configuration frozen, no more admin changes allowed",
                    args: {},
                  }))
                ),
              ]
            : [];

        // ── Tezcatli vault governance
        const vault = addr.tezcatliVault;
        const vaultTasks = vault
          ? [
              scanContractEvents(client, vault, TEZCATLI_VAULT_ADMIN_ABI[0], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "TezcatliVault" as const,
                  contract: vault,
                  name: "StrategyAdapterUpdated",
                  severity: "critical" as const,
                  summary: `Tezcatli strategy adapter changed: ${short(l.args.previousAdapter as string)} → ${short(l.args.newAdapter as string)}`,
                  args: {
                    previousAdapter: l.args.previousAdapter as string,
                    newAdapter: l.args.newAdapter as string,
                  },
                }))
              ),
              scanContractEvents(client, vault, TEZCATLI_VAULT_ADMIN_ABI[1], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "TezcatliVault" as const,
                  contract: vault,
                  name: "ComplianceGateUpdated",
                  severity: "warn" as const,
                  summary: `Tezcatli compliance gate ${l.args.enabled ? "ENABLED" : "disabled"} → ${short(l.args.complianceGate as string)}`,
                  args: {
                    complianceGate: l.args.complianceGate as string,
                    enabled: Boolean(l.args.enabled),
                  },
                }))
              ),
              scanContractEvents(client, vault, TEZCATLI_VAULT_ADMIN_ABI[2], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "TezcatliVault" as const,
                  contract: vault,
                  name: "FeeModelUpdated",
                  severity: "warn" as const,
                  summary: `Tezcatli fee model: ${short(l.args.previousFeeModel as string)} → ${short(l.args.newFeeModel as string)}`,
                  args: {
                    previousFeeModel: l.args.previousFeeModel as string,
                    newFeeModel: l.args.newFeeModel as string,
                  },
                }))
              ),
              scanContractEvents(client, vault, TEZCATLI_VAULT_ADMIN_ABI[4], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "TezcatliVault" as const,
                  contract: vault,
                  name: "SettlementPendingUpdated",
                  severity: l.args.status ? ("critical" as const) : ("warn" as const),
                  summary: l.args.status
                    ? "⚠ Tezcatli settlement PENDING — DeFi withdrawals on hold"
                    : "Tezcatli settlement resumed — withdrawals re-enabled",
                  args: { status: Boolean(l.args.status) },
                }))
              ),
              scanContractEvents(client, vault, TEZCATLI_VAULT_ADMIN_ABI[5], from, to).then((logs) =>
                logs.map((l) => ({
                  ...l,
                  source: "TezcatliVault" as const,
                  contract: vault,
                  name: "EmergencyTokenRecovered",
                  severity: "critical" as const,
                  summary: `🚨 Emergency token recovery: ${short(l.args.token as string)} → ${short(l.args.to as string)} (${(l.args.amount as bigint).toString()})`,
                  args: {
                    token: l.args.token as string,
                    to: l.args.to as string,
                    amount: (l.args.amount as bigint).toString(),
                  },
                }))
              ),
            ]
          : [];

        // Run all scans for this chain in parallel and stamp with timestamps.
        const allTasks = [
          ...recoveryTasks,
          ...paymasterTasks,
          ...sweeperTasks,
          ...ledgerTasks,
          ...vaultTasks,
        ];
        const results = await Promise.all(allTasks);
        const flat = results.flat().map((r) => ({
          chainId,
          blockNumber: r.blockNumber,
          txHash: r.transactionHash,
          contract: r.contract,
          source: r.source,
          name: r.name,
          severity: r.severity,
          summary: r.summary,
          args: r.args,
        }));
        const withTs = await withBlockTimestamps(client, flat);
        events.push(...(withTs as unknown as GovEvent[]));
      })
    );

    return events.sort((a, b) => b.blockTimestamp - a.blockTimestamp);
  });
}

/**
 * Open recoveries — RecoveryInitiated events with no matching
 * RecoveryFinalized/RecoveryCancelled on the same account at a later block.
 * Used for /health alerts.
 */
export function openRecoveries(events: GovEvent[]): GovEvent[] {
  const lastByAccount = new Map<string, GovEvent>();
  for (const e of events) {
    if (e.source !== "RecoveryModule") continue;
    if (!["RecoveryInitiated", "RecoveryFinalized", "RecoveryCancelled"].includes(e.name)) continue;
    const account = String(e.args.account ?? "").toLowerCase();
    if (!account) continue;
    const prev = lastByAccount.get(account);
    if (!prev || e.blockTimestamp > prev.blockTimestamp) {
      lastByAccount.set(account, e);
    }
  }
  return Array.from(lastByAccount.values()).filter((e) => e.name === "RecoveryInitiated");
}

/**
 * Latest LegacyEnabledSet event — if `enabled=true`, the V1 attack surface
 * is exposed. Returns null if no event seen.
 */
export function legacySweeperState(events: GovEvent[]): { chainId: SupportedChainId; enabled: boolean; ts: number }[] {
  const latestPerChain = new Map<SupportedChainId, GovEvent>();
  for (const e of events) {
    if (e.source !== "Sweeper" || e.name !== "LegacyEnabledSet") continue;
    const prev = latestPerChain.get(e.chainId);
    if (!prev || e.blockTimestamp > prev.blockTimestamp) latestPerChain.set(e.chainId, e);
  }
  return Array.from(latestPerChain.values()).map((e) => ({
    chainId: e.chainId,
    enabled: Boolean(e.args.enabled),
    ts: e.blockTimestamp,
  }));
}
