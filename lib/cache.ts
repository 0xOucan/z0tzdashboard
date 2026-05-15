/**
 * Tiny in-memory cache with TTL + in-flight request deduplication.
 *
 * Survives only for the lifetime of a single serverless invocation on
 * Vercel — repeated hits within the same warm container reuse, cold
 * starts re-fetch. For cross-instance persistence, see lib/persistent-cache.ts.
 *
 * The in-flight dedupe is what stops two simultaneous callers (e.g. the
 * Overview page AND an audit panel both invoking getRelayerCashFlow) from
 * each firing their own underlying fn() against the rate-limited API.
 */
const store = new Map<string, { value: unknown; expires: number }>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value as T;
  }
  // Dedupe simultaneous callers — return the same in-flight promise.
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise as Promise<T>;
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
