/**
 * Process-wide rate limiter for Etherscan V2 calls.
 *
 * Etherscan free tier caps at 3 requests/sec per IP. Both lib/explorerApi.ts
 * (tx-history calls) and lib/deployment.ts (getblocknobytime calls) hit the
 * same V2 endpoint and share the limit — so they MUST share the limiter.
 *
 * Node's module system makes this trivial: this file is loaded once per
 * Vercel function instance, the `lastCallTs` const is module-singleton, and
 * every importer waits against the same clock.
 *
 * Cross-instance racing (multiple Vercel functions cold-starting at once)
 * is still possible — that's handled by retry-with-jitter in the callers,
 * plus the 7-day disk cache for deployment blocks and 1-hour disk cache
 * for tx history.
 */

let lastCallTs = 0;

/** Minimum milliseconds between V2 calls. 400ms ≈ 2.5 req/sec, under 3. */
const MIN_GAP_MS = 400;

export async function waitForEtherscanSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTs;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastCallTs = Date.now();
}
