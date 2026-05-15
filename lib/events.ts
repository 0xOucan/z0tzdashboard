/**
 * Event readers. Each function pulls raw logs from chain via the incremental
 * scanner (lib/incremental.ts), which reads the last session's checkpoint
 * off disk and only fetches the block-range delta since then.
 *
 * In-memory cache (lib/cache.ts) layers on top with a 60s TTL to collapse
 * repeated calls within the same render.
 */
import type { Address } from "viem";
import { ADDRESSES } from "./addresses";
import {
  SWEEPER_ABI,
  LEDGER_ABI,
  ENTRY_POINT_ABI,
  CCTP_ABI,
  ENTRY_POINT_DEPOSIT_ABI,
} from "./abis";
import { cached } from "./cache";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./rpc";
import {
  getScanRange,
  scanLogsReverse,
  withBlockTimestamps,
  latestBlock,
} from "./scanner";
import { incrementalScan } from "./incremental";
import { publicClient } from "./chains";

// Bumped from 60s to 5min — events are immutable past finality and the
// incremental scanner only fetches the block-range delta anyway, so a
// stale-by-5-min cache hit is functionally identical to a fresh scan
// while massively cutting page-load latency on warm Vercel instances.
const CACHE_TTL = 300;
const ZERO = "0x0000000000000000000000000000000000000000";

// Re-exports for downstream readers
export { getScanRange, scanLogsReverse, withBlockTimestamps, latestBlock };

export type SweepEvent = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
  stealthAddress: Address;
  shieldedAmount: bigint;
  fee: bigint;
};

export type LedgerCreditEvent = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
  ledgerId: `0x${string}`;
  netAmount: bigint;
};

export type LedgerSpentEvent = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
  oldId: `0x${string}`;
  newId: `0x${string}`;
  action: "Internal" | "Cashout";
};

export type PaymasterOpEvent = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
  sender: Address;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
};

export type CctpBurnEvent = {
  chainId: SupportedChainId;
  blockNumber: bigint;
  blockTimestamp: number;
  txHash: `0x${string}`;
  depositor: Address;
  amount: bigint;
  destinationDomain: number;
};

// ---------------------------------------------------------------------------
// Sweep events (cash-in volume)
// ---------------------------------------------------------------------------

export async function getSweepEvents(chainId: SupportedChainId): Promise<SweepEvent[]> {
  return cached(`sweep:${chainId}`, CACHE_TTL, async () => {
    const addr = ADDRESSES[chainId].sweeper;
    return incrementalScan<unknown, SweepEvent>({
      chainId,
      contractAddress: addr,
      eventKey: "sweep",
      getLogs: (client, from, to) =>
        client.getLogs({
          address: addr,
          event: SWEEPER_ABI[0],
          fromBlock: from,
          toBlock: to,
        }),
      decode: (log: any, chainId) => ({
        chainId,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        stealthAddress: log.args.stealthAddress as Address,
        shieldedAmount: log.args.shieldedAmount as bigint,
        fee: log.args.fee as bigint,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Ledger events
// ---------------------------------------------------------------------------

export async function getLedgerCredits(chainId: SupportedChainId): Promise<LedgerCreditEvent[]> {
  return cached(`ledgerCredit:${chainId}`, CACHE_TTL, async () => {
    const addr = ADDRESSES[chainId].ledger;
    return incrementalScan<unknown, LedgerCreditEvent>({
      chainId,
      contractAddress: addr,
      eventKey: "ledgerCredit",
      getLogs: (client, from, to) =>
        client.getLogs({
          address: addr,
          event: LEDGER_ABI[0],
          fromBlock: from,
          toBlock: to,
        }),
      decode: (log: any, chainId) => ({
        chainId,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        ledgerId: log.args.ledgerId as `0x${string}`,
        netAmount: BigInt(log.args.netAmount as bigint),
      }),
    });
  });
}

export async function getLedgerSpends(chainId: SupportedChainId): Promise<LedgerSpentEvent[]> {
  return cached(`ledgerSpend:${chainId}`, CACHE_TTL, async () => {
    const addr = ADDRESSES[chainId].ledger;
    return incrementalScan<unknown, LedgerSpentEvent>({
      chainId,
      contractAddress: addr,
      eventKey: "ledgerSpend",
      getLogs: (client, from, to) =>
        client.getLogs({
          address: addr,
          event: LEDGER_ABI[1],
          fromBlock: from,
          toBlock: to,
        }),
      decode: (log: any, chainId) => ({
        chainId,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        oldId: log.args.oldId as `0x${string}`,
        newId: log.args.newId as `0x${string}`,
        action: (Number(log.args.action) === 1 ? "Cashout" : "Internal") as "Internal" | "Cashout",
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Paymaster sponsorships
// ---------------------------------------------------------------------------

export async function getPaymasterOps(chainId: SupportedChainId): Promise<PaymasterOpEvent[]> {
  return cached(`paymasterOps:${chainId}`, CACHE_TTL, async () => {
    const { entryPoint, paymaster } = ADDRESSES[chainId];
    return incrementalScan<unknown, PaymasterOpEvent>({
      chainId,
      // Logical contract for cache invalidation is the paymaster (not entryPoint).
      contractAddress: paymaster,
      eventKey: "paymasterOps",
      getLogs: (client, from, to) =>
        client.getLogs({
          address: entryPoint,
          event: ENTRY_POINT_ABI[0],
          args: { paymaster },
          fromBlock: from,
          toBlock: to,
        }),
      decode: (log: any, chainId) => ({
        chainId,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        sender: log.args.sender as Address,
        success: Boolean(log.args.success),
        actualGasCost: log.args.actualGasCost as bigint,
        actualGasUsed: log.args.actualGasUsed as bigint,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// CCTP burns
// ---------------------------------------------------------------------------

export async function getCctpBurns(chainId: SupportedChainId): Promise<CctpBurnEvent[]> {
  return cached(`cctp:${chainId}`, CACHE_TTL, async () => {
    const { cctpTokenMessenger, usdc } = ADDRESSES[chainId];
    return incrementalScan<unknown, CctpBurnEvent>({
      chainId,
      contractAddress: cctpTokenMessenger,
      eventKey: "cctp",
      getLogs: (client, from, to) =>
        client.getLogs({
          address: cctpTokenMessenger,
          event: CCTP_ABI[0],
          args: { burnToken: usdc },
          fromBlock: from,
          toBlock: to,
        }),
      decode: (log: any, chainId) => ({
        chainId,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        depositor: log.args.depositor as Address,
        amount: log.args.amount as bigint,
        destinationDomain: Number(log.args.destinationDomain),
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Wallet balances — never cached to disk (always live)
// ---------------------------------------------------------------------------

export type WalletBalance = {
  chainId: SupportedChainId;
  address: Address;
  ethBalance: bigint;
  paymasterDeposit?: bigint;
};

export async function getOperationalBalances(): Promise<{
  relayer: WalletBalance[];
  paymaster: WalletBalance[];
}> {
  return cached("opBalances", 30, async () => {
    const relayer: WalletBalance[] = [];
    const paymaster: WalletBalance[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const client = publicClient(chainId);
        const addr = ADDRESSES[chainId];
        const [relayerBal, paymasterDeposit] = await Promise.all([
          client.getBalance({ address: addr.relayerWallet }),
          addr.paymaster !== ZERO
            ? client
                .readContract({
                  address: addr.entryPoint,
                  abi: ENTRY_POINT_DEPOSIT_ABI,
                  functionName: "balanceOf",
                  args: [addr.paymaster],
                })
                .catch(() => 0n)
            : Promise.resolve(0n),
        ]);
        relayer.push({ chainId, address: addr.relayerWallet, ethBalance: relayerBal });
        paymaster.push({
          chainId,
          address: addr.paymaster,
          ethBalance: 0n,
          paymasterDeposit: paymasterDeposit as bigint,
        });
      })
    );
    return { relayer, paymaster };
  });
}
