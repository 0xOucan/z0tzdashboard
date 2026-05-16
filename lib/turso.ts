/**
 * Turso (libSQL) backend for cross-instance persistence.
 *
 * Replaces the /tmp file cache on Vercel — where /tmp is per-function-instance
 * ephemeral and cold starts always re-fetch — with a hosted SQLite database
 * shared across every function instance.
 *
 * Three tables, all created lazily on first use:
 *   - checkpoints       generic K/V store for the existing readCheckpoint/
 *                       writeCheckpoint API (deploy blocks, in-flight scan
 *                       state, etc.)
 *   - scan_state        per-(chain, address) Etherscan sync cursor:
 *                       last_block_scanned + last_fetched_at
 *   - txs               raw Etherscan tx rows, dedup'd by (chain_id, tx_hash).
 *                       Indexed on from_addr + to_addr so queries for a given
 *                       wallet's activity hit an index.
 *
 * If TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing, `isEnabled()` returns
 * false and callers fall back to the legacy /tmp path.
 */
import { createClient, type Client, type InValue } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

let _client: Client | null = null;
let _schemaPromise: Promise<void> | null = null;

export function isEnabled(): boolean {
  return !!(url && authToken);
}

export function client(): Client {
  if (!isEnabled()) {
    throw new Error("Turso not configured (set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)");
  }
  if (!_client) {
    _client = createClient({ url: url!, authToken: authToken! });
  }
  return _client;
}

/**
 * Idempotent schema bootstrap. Cached as a singleton promise so ~18 callers
 * racing on first cold start share one round-trip.
 */
export async function ensureSchema(): Promise<void> {
  if (!isEnabled()) return;
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    const c = client();
    await c.batch(
      [
        `CREATE TABLE IF NOT EXISTS checkpoints (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS scan_state (
          chain_id INTEGER NOT NULL,
          address TEXT NOT NULL,
          last_block_scanned INTEGER NOT NULL,
          last_fetched_at INTEGER NOT NULL,
          PRIMARY KEY (chain_id, address)
        )`,
        `CREATE TABLE IF NOT EXISTS txs (
          chain_id INTEGER NOT NULL,
          tx_hash TEXT NOT NULL,
          block_number INTEGER NOT NULL,
          block_timestamp INTEGER NOT NULL,
          from_addr TEXT NOT NULL,
          to_addr TEXT,
          value_wei TEXT NOT NULL,
          gas_used INTEGER,
          gas_price TEXT,
          is_error INTEGER,
          PRIMARY KEY (chain_id, tx_hash)
        )`,
        `CREATE INDEX IF NOT EXISTS ix_txs_from ON txs (chain_id, from_addr, block_number)`,
        `CREATE INDEX IF NOT EXISTS ix_txs_to   ON txs (chain_id, to_addr,   block_number)`,
      ],
      "write"
    );
  })();
  try {
    await _schemaPromise;
  } catch (err) {
    _schemaPromise = null; // allow retry on next call
    throw err;
  }
}

// ─── Checkpoint K/V (compat layer for lib/persistent-cache.ts) ────────────

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { __bigint: value.toString() };
  return value;
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "__bigint" in (value as Record<string, unknown>) &&
    typeof (value as { __bigint: unknown }).__bigint === "string"
  ) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}

export async function getCheckpoint<T>(key: string): Promise<T | null> {
  if (!isEnabled()) return null;
  await ensureSchema();
  const res = await client().execute({
    sql: "SELECT value FROM checkpoints WHERE key = ?",
    args: [key],
  });
  const row = res.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value as string, bigintReviver) as T;
  } catch {
    return null;
  }
}

export async function setCheckpoint<T>(key: string, value: T): Promise<void> {
  if (!isEnabled()) return;
  await ensureSchema();
  const json = JSON.stringify(value, bigintReplacer);
  await client().execute({
    sql: `INSERT INTO checkpoints (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, json, Date.now()],
  });
}

// ─── Scan state ──────────────────────────────────────────────────────────

export type ScanState = {
  lastBlockScanned: number;
  lastFetchedAt: number;
};

export async function getScanState(
  chainId: number,
  address: string
): Promise<ScanState | null> {
  if (!isEnabled()) return null;
  await ensureSchema();
  const res = await client().execute({
    sql: "SELECT last_block_scanned, last_fetched_at FROM scan_state WHERE chain_id = ? AND address = ?",
    args: [chainId, address.toLowerCase()],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    lastBlockScanned: Number(row.last_block_scanned),
    lastFetchedAt: Number(row.last_fetched_at),
  };
}

export async function setScanState(
  chainId: number,
  address: string,
  lastBlockScanned: number,
  lastFetchedAt: number = Date.now()
): Promise<void> {
  if (!isEnabled()) return;
  await ensureSchema();
  await client().execute({
    sql: `INSERT INTO scan_state (chain_id, address, last_block_scanned, last_fetched_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(chain_id, address) DO UPDATE SET
            last_block_scanned = excluded.last_block_scanned,
            last_fetched_at    = excluded.last_fetched_at`,
    args: [chainId, address.toLowerCase(), lastBlockScanned, lastFetchedAt],
  });
}

// ─── Tx history ──────────────────────────────────────────────────────────

export type DbTx = {
  hash: string;
  blockNumber: number;
  blockTimestamp: number;
  fromAddr: string;
  toAddr: string | null;
  valueWei: string;
  gasUsed: number;
  gasPrice: string;
  isError: boolean;
};

export async function insertTxs(chainId: number, txs: DbTx[]): Promise<void> {
  if (!isEnabled() || txs.length === 0) return;
  await ensureSchema();
  // libSQL batches up to ~100 statements per call efficiently; chunk to keep
  // things tidy.
  const CHUNK = 200;
  for (let i = 0; i < txs.length; i += CHUNK) {
    const slice = txs.slice(i, i + CHUNK);
    await client().batch(
      slice.map((tx) => ({
        sql: `INSERT OR IGNORE INTO txs
              (chain_id, tx_hash, block_number, block_timestamp, from_addr, to_addr, value_wei, gas_used, gas_price, is_error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          chainId,
          tx.hash.toLowerCase(),
          tx.blockNumber,
          tx.blockTimestamp,
          tx.fromAddr.toLowerCase(),
          tx.toAddr ? tx.toAddr.toLowerCase() : null,
          tx.valueWei,
          tx.gasUsed,
          tx.gasPrice,
          tx.isError ? 1 : 0,
        ] as InValue[],
      })),
      "write"
    );
  }
}

/**
 * All txs where the address appears as from OR to, since `minBlock` inclusive,
 * sorted newest first.
 */
export async function queryTxs(
  chainId: number,
  address: string,
  minBlock: number
): Promise<DbTx[]> {
  if (!isEnabled()) return [];
  await ensureSchema();
  const addr = address.toLowerCase();
  const res = await client().execute({
    sql: `SELECT tx_hash, block_number, block_timestamp, from_addr, to_addr,
                 value_wei, gas_used, gas_price, is_error
          FROM txs
          WHERE chain_id = ?
            AND block_number >= ?
            AND (from_addr = ? OR to_addr = ?)
          ORDER BY block_number DESC`,
    args: [chainId, minBlock, addr, addr],
  });
  return res.rows.map((row) => ({
    hash: row.tx_hash as string,
    blockNumber: Number(row.block_number),
    blockTimestamp: Number(row.block_timestamp),
    fromAddr: row.from_addr as string,
    toAddr: (row.to_addr as string | null) ?? null,
    valueWei: row.value_wei as string,
    gasUsed: Number(row.gas_used ?? 0),
    gasPrice: (row.gas_price as string) ?? "0",
    isError: Number(row.is_error ?? 0) === 1,
  }));
}
