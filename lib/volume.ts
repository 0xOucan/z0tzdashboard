/**
 * Volume-bot telemetry queries.
 *
 * The volumebot writes to `bot_runs`, `bot_cycles`, `bot_ops`, and
 * `bot_pool_snapshots` on the same Turso instance the indexer uses.
 * These helpers aggregate those rows for the /volume dashboard page.
 *
 * The bot's Turso instance is SEPARATE from the indexer's. Env vars:
 *   VOLUMEBOT_TURSO_DATABASE_URL
 *   VOLUMEBOT_TURSO_AUTH_TOKEN
 *
 * Indexer's TURSO_* vars stay reserved for the indexer pages. The
 * dashboard can hold both sets without collision.
 */
import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;

function client(): Client {
  if (_client) return _client;
  const url = process.env.VOLUMEBOT_TURSO_DATABASE_URL;
  const authToken = process.env.VOLUMEBOT_TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("VOLUMEBOT_TURSO_DATABASE_URL + VOLUMEBOT_TURSO_AUTH_TOKEN required for volume page");
  }
  _client = createClient({ url, authToken });
  return _client;
}

export interface VolumeKpis {
  totalRuns: number;
  totalCyclesAttempted: number;
  totalCyclesSucceeded: number;
  totalCyclesFailed: number;
  totalVolumeUsdcMicros: bigint;
  totalGasSpentEthWei: bigint;
  activeRunId: string | null;
}

export interface OpsByChain {
  chainId: number;
  successCount: number;
  failedCount: number;
  totalGasUsed: bigint;
  avgDurationMs: number;
}

export interface RecentCycle {
  cycleId: string;
  runId: string;
  cycleIdx: number;
  flow: string;
  srcChainId: number;
  dstChainId: number;
  amountUsdcMicros: bigint;
  startedAt: number;
  completedAt: number | null;
  status: string;
  failureReason: string | null;
}

export interface ThroughputBucket {
  /** Unix-ms timestamp at start of the bucket. */
  bucketStart: number;
  cyclesCompleted: number;
  volumeUsdcMicros: bigint;
}

/**
 * Headline KPIs across every run in the DB (or scoped to one
 * `runId` if provided — useful for "live run" view).
 */
export async function getVolumeKpis(opts: { runId?: string } = {}): Promise<VolumeKpis> {
  const where = opts.runId ? "WHERE run_id = ?" : "";
  const args: any[] = opts.runId ? [opts.runId] : [];
  const c = client();
  // Two queries: aggregate + active-run lookup. Cheap on libsql, do
  // them concurrently.
  const [agg, runs, opsAgg] = await Promise.all([
    c.execute({
      sql: `SELECT COUNT(*) AS total_cycles,
                   SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,
                   SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) AS bad,
                   SUM(CASE WHEN status='success' THEN amount_usdc_micros ELSE 0 END) AS vol
            FROM bot_cycles ${where}`,
      args,
    }),
    c.execute({
      sql: `SELECT COUNT(*) AS n,
                   MAX(CASE WHEN ended_at IS NULL THEN run_id END) AS live
            FROM bot_runs ${opts.runId ? "WHERE run_id = ?" : ""}`,
      args,
    }),
    c.execute({
      sql: `SELECT COALESCE(SUM(CAST(eth_spent_wei AS INTEGER)), 0) AS gas
            FROM bot_ops bo
            JOIN bot_cycles bc ON bo.cycle_id = bc.cycle_id
            ${opts.runId ? "WHERE bc.run_id = ?" : ""}`,
      args,
    }),
  ]);
  const a = agg.rows[0] ?? ({} as any);
  const r = runs.rows[0] ?? ({} as any);
  const o = opsAgg.rows[0] ?? ({} as any);
  return {
    totalRuns: Number(r.n ?? 0),
    totalCyclesAttempted: Number(a.total_cycles ?? 0),
    totalCyclesSucceeded: Number(a.ok ?? 0),
    totalCyclesFailed: Number(a.bad ?? 0),
    totalVolumeUsdcMicros: BigInt(String(a.vol ?? "0")),
    totalGasSpentEthWei: BigInt(String(o.gas ?? "0")),
    activeRunId: r.live ? String(r.live) : null,
  };
}

/**
 * Per-chain op aggregates so we can render a "base vs arb" breakdown.
 */
export async function getOpsByChain(opts: { runId?: string } = {}): Promise<OpsByChain[]> {
  const where = opts.runId ? "WHERE bc.run_id = ?" : "";
  const args = opts.runId ? [opts.runId] : [];
  const c = client();
  const res = await c.execute({
    sql: `SELECT bo.chain_id,
                 SUM(CASE WHEN bo.status='success' THEN 1 ELSE 0 END) AS ok,
                 SUM(CASE WHEN bo.status='failed'  THEN 1 ELSE 0 END) AS bad,
                 COALESCE(SUM(bo.gas_used), 0) AS gas,
                 AVG(bo.duration_ms) AS avgms
          FROM bot_ops bo
          JOIN bot_cycles bc ON bo.cycle_id = bc.cycle_id
          ${where}
          GROUP BY bo.chain_id
          ORDER BY bo.chain_id`,
    args,
  });
  return res.rows.map((r: any) => ({
    chainId: Number(r.chain_id),
    successCount: Number(r.ok ?? 0),
    failedCount: Number(r.bad ?? 0),
    totalGasUsed: BigInt(String(r.gas ?? "0")),
    avgDurationMs: Number(r.avgms ?? 0),
  }));
}

/**
 * Latest N cycles, newest first. Drives a recent-activity table.
 */
export async function getRecentCycles(limit: number = 25, runId?: string): Promise<RecentCycle[]> {
  const where = runId ? "WHERE run_id = ?" : "";
  const args: any[] = runId ? [runId, limit] : [limit];
  const c = client();
  const res = await c.execute({
    sql: `SELECT * FROM bot_cycles ${where}
          ORDER BY started_at DESC LIMIT ?`,
    args,
  });
  return res.rows.map((r: any) => ({
    cycleId: String(r.cycle_id),
    runId: String(r.run_id),
    cycleIdx: Number(r.cycle_idx),
    flow: String(r.flow),
    srcChainId: Number(r.src_chain_id),
    dstChainId: Number(r.dst_chain_id),
    amountUsdcMicros: BigInt(String(r.amount_usdc_micros ?? "0")),
    startedAt: Number(r.started_at),
    completedAt: r.completed_at !== null ? Number(r.completed_at) : null,
    status: String(r.status),
    failureReason: r.failure_reason ? String(r.failure_reason) : null,
  }));
}

/**
 * Bucket completed cycles into N-minute windows. Used for throughput-
 * over-time charts. Default bucket = 5 minutes.
 */
export async function getThroughput(opts: {
  runId?: string;
  bucketMs?: number;
  limitBuckets?: number;
} = {}): Promise<ThroughputBucket[]> {
  const bucketMs = opts.bucketMs ?? 5 * 60 * 1000;
  const limit = opts.limitBuckets ?? 144; // 12 hours at 5-min buckets
  const c = client();
  const where = opts.runId ? "WHERE run_id = ? AND status = 'success'" : "WHERE status = 'success'";
  const args = opts.runId ? [opts.runId] : [];
  const res = await c.execute({
    sql: `SELECT (completed_at / ?) * ? AS bucket,
                 COUNT(*) AS n,
                 SUM(amount_usdc_micros) AS vol
          FROM bot_cycles
          ${where}
          GROUP BY bucket
          ORDER BY bucket DESC
          LIMIT ?`,
    args: [bucketMs, bucketMs, ...args, limit],
  });
  return res.rows
    .map((r: any) => ({
      bucketStart: Number(r.bucket),
      cyclesCompleted: Number(r.n ?? 0),
      volumeUsdcMicros: BigInt(String(r.vol ?? "0")),
    }))
    .reverse(); // ascending time for charts
}

/**
 * Most recent pool snapshot per chain — the bot writes one every
 * POOL_SNAPSHOT_INTERVAL_S so we always have a fresh capital view.
 */
export async function getLatestPoolSnapshot(runId?: string): Promise<Array<{
  chainId: number;
  sourceUsdcMicros: bigint;
  inFlightCycles: number;
  cumulativeFeesMicros: bigint;
  takenAt: number;
}>> {
  const c = client();
  const where = runId ? "WHERE run_id = ?" : "";
  const args = runId ? [runId] : [];
  // Latest snapshot per chain.
  const res = await c.execute({
    sql: `SELECT chain_id,
                 source_usdc_micros,
                 in_flight_cycles,
                 cumulative_fees_micros,
                 MAX(taken_at) AS taken_at
          FROM bot_pool_snapshots ${where}
          GROUP BY chain_id
          ORDER BY chain_id`,
    args,
  });
  return res.rows.map((r: any) => ({
    chainId: Number(r.chain_id),
    sourceUsdcMicros: BigInt(String(r.source_usdc_micros ?? "0")),
    inFlightCycles: Number(r.in_flight_cycles ?? 0),
    cumulativeFeesMicros: BigInt(String(r.cumulative_fees_micros ?? "0")),
    takenAt: Number(r.taken_at ?? 0),
  }));
}
