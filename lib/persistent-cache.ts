/**
 * File-based KV cache. Survives dev server restarts, page refreshes, and
 * function reinvocations. Backs the incremental event scanner so a refresh
 * only fetches the delta since the last scan, not the full deploy → latest
 * range.
 *
 * Vercel note: serverless functions can't write to project cwd. Set
 * `Z0TZ_CACHE_DIR=/tmp/z0tz-cache` to use the warm-instance ephemeral disk,
 * or switch to Vercel KV / Upstash Redis for cold-start persistence.
 *
 * Concurrency: ~18 event-source caches write near-simultaneously on a fresh
 * scan. Vercel functions cap open file descriptors low — letting all 18
 * writes race produced EMFILE: too many open files. All writes serialize
 * through a shared promise chain so at most one FS handle is in flight.
 */
import { promises as fs } from "fs";
import path from "path";

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
  try {
    const file = path.join(CACHE_DIR, safeKey(key) + ".json");
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data, bigintReviver) as T;
  } catch {
    return null;
  }
}

// Serialize all writes through a single promise chain. This caps FD usage at
// 1 at a time (mkdir + writeFile both count) which prevents EMFILE on Vercel
// when ~18 caches try to flush simultaneously.
let writeChain: Promise<void> = Promise.resolve();

export function writeCheckpoint<T>(key: string, value: T): Promise<void> {
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
            ? "filesystem read-only — set Z0TZ_CACHE_DIR=/tmp/z0tz-cache on Vercel"
            : e.code === "EMFILE" || e.code === "ENFILE"
            ? "too many open files — writes are serialized, should self-resolve"
            : "unknown — accepting slower cold starts";
        console.warn(
          `[z0tz-dashboard] Persistent cache write failed (${e.code ?? "?"}): ${hint}. (${e.message})`
        );
      }
    }
  });
  // Detach error so the chain isn't poisoned for the next writer.
  writeChain = next.catch(() => {});
  return next;
}

export async function purgeAllCheckpoints(): Promise<void> {
  try {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export function getCacheDir(): string {
  return CACHE_DIR;
}
