/**
 * Generic K/V checkpoint cache.
 *
 * Backend selection (at runtime, per call):
 *   1. Turso (libSQL) — used when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 *      are set. Shared across every Vercel function instance, survives
 *      cold starts. Preferred.
 *   2. /tmp file cache — fallback for local dev (or when Turso isn't
 *      configured). On Vercel, /tmp is per-instance ephemeral so cold
 *      starts always re-fetch; that's why Turso is the upgrade path.
 *
 * Concurrency on the /tmp path: ~18 event-source caches write near-
 * simultaneously on a fresh scan. Vercel functions cap open file
 * descriptors low — letting all 18 writes race produced EMFILE. The /tmp
 * path serializes writes through a shared promise chain. Turso doesn't
 * have this issue since it's network-bound.
 */
import { promises as fs } from "fs";
import path from "path";
import * as turso from "./turso";

const CACHE_DIR =
  process.env.Z0TZ_CACHE_DIR || path.join(process.cwd(), ".z0tz-cache");

let warnedReadOnly = false;

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_/-]/g, "_");
}

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

export async function readCheckpoint<T>(key: string): Promise<T | null> {
  // Turso path
  if (turso.isEnabled()) {
    try {
      return await turso.getCheckpoint<T>(key);
    } catch (err) {
      console.warn(`[persistent-cache] Turso read failed for ${key}: ${(err as Error).message}`);
      // fall through to /tmp
    }
  }
  // /tmp path
  try {
    const file = path.join(CACHE_DIR, safeKey(key) + ".json");
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data, bigintReviver) as T;
  } catch {
    return null;
  }
}

// Serialize /tmp writes through a single promise chain so concurrent writers
// don't pile up open FDs (EMFILE on Vercel). Turso writes are network-bound,
// no FD pressure, so we don't gate them.
let writeChain: Promise<void> = Promise.resolve();

export function writeCheckpoint<T>(key: string, value: T): Promise<void> {
  if (turso.isEnabled()) {
    return turso.setCheckpoint(key, value).catch((err: Error) => {
      console.warn(`[persistent-cache] Turso write failed for ${key}: ${err.message}`);
    });
  }
  const next = writeChain.then(async () => {
    const file = path.join(CACHE_DIR, safeKey(key) + ".json");
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(value, bigintReplacer));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (!warnedReadOnly) {
        warnedReadOnly = true;
        const hint =
          e.code === "EACCES" || e.code === "EROFS" || e.code === "ENOENT"
            ? "filesystem read-only — set TURSO_DATABASE_URL+TURSO_AUTH_TOKEN, or Z0TZ_CACHE_DIR=/tmp/z0tz-cache on Vercel"
            : e.code === "EMFILE" || e.code === "ENFILE"
            ? "too many open files — writes are serialized, should self-resolve"
            : "unknown — accepting slower cold starts";
        console.warn(
          `[z0tz-dashboard] Persistent cache write failed (${e.code ?? "?"}): ${hint}. (${e.message})`
        );
      }
    }
  });
  writeChain = next.catch(() => {});
  return next;
}

export async function purgeAllCheckpoints(): Promise<void> {
  // Note: Turso checkpoints aren't purged here — use the Turso UI or a
  // manual `DELETE FROM checkpoints` if you need a hard reset.
  try {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export function getCacheDir(): string {
  return CACHE_DIR;
}
