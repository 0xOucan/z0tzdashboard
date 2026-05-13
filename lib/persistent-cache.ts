/**
 * File-based KV cache. Survives dev server restarts, page refreshes, and
 * function reinvocations. Backs the incremental event scanner so a refresh
 * only fetches the delta since the last scan, not the full deploy → latest
 * range.
 *
 * Vercel note: serverless functions can't write to project cwd. Set
 * `Z0TZ_CACHE_DIR=/tmp/z0tz-cache` to use the warm-instance ephemeral disk,
 * or switch to Vercel KV / Upstash Redis for cold-start persistence.
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

export async function writeCheckpoint<T>(key: string, value: T): Promise<void> {
  const file = path.join(CACHE_DIR, safeKey(key) + ".json");
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, bigintReplacer));
  } catch (err) {
    if (!warnedReadOnly) {
      warnedReadOnly = true;
      console.warn(
        `[z0tz-dashboard] Persistent cache disabled — ${path.dirname(file)} is read-only or unwritable. ` +
          `Set Z0TZ_CACHE_DIR=/tmp/z0tz-cache on Vercel, or accept slower cold starts. (${(err as Error).message})`
      );
    }
  }
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
