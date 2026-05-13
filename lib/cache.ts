/**
 * Tiny in-memory cache with TTL. Survives only for the lifetime of a single
 * serverless invocation on Vercel — repeated hits within the same warm
 * container reuse, cold starts re-fetch.
 *
 * For sustained traffic, replace with Vercel KV / Upstash Redis by swapping
 * the read/write functions. The call sites all use cached(key, ttl, fn).
 */
const store = new Map<string, { value: unknown; expires: number }>();

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  return value;
}

export function purge(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
