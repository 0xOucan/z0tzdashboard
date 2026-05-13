# Z0tz Dashboard

Internal admin dashboard for monitoring the Z0tz relayer + paymaster economy. Tracks USDC cashed in / out, paymaster gas spend, relayer-wallet gas spend, Tezcatli vault TVL, and CCTP bridge volume across Base / Eth / Arb Sepolia.

> **Not user-facing.** This tool reads on-chain Z0tz events and exposes them behind HTTP Basic Auth. Deploy as a private Vercel project; share the URL + credentials only with the Z0tz operations team.

## Quick start

```bash
cp .env.example .env.local
# edit .env.local — set ADMIN_USER + ADMIN_PASS at minimum
pnpm install     # or npm install
pnpm dev         # http://localhost:3000
```

Browser will prompt for the basic-auth credentials.

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import into Vercel as a new project.
3. Set environment variables in Project Settings → Environment Variables:
   - `ADMIN_USER` (any non-empty string)
   - `ADMIN_PASS` (long random string — use `openssl rand -hex 24`)
   - `RPC_URL_84532` / `_11155111` / `_421614` (optional — paid RPCs override the public pool)
   - `COINGECKO_API_KEY` (optional)
4. Deploy. Visit the production URL, log in with `ADMIN_USER` + `ADMIN_PASS`.

## What it shows

| Page | Source | What it tracks |
|---|---|---|
| **Home** | All sources | Top-line KPIs: total USDC in/out, paymaster + relayer ETH balances, days-of-runway |
| **Cash In** | `Z0tzPrivateSweeperV2.PrivateSweep` + `Z0tzPrivateLedger.CreditedFromVault` | Daily inflow volume per chain, sweep count, top sweep sizes |
| **Cash Out** | `Z0tzPrivateLedger.Spent` + vault USDC `Transfer` | Daily outflow volume per chain, same-chain vs CCTP-bridged |
| **Gas** | EntryPoint `UserOperationEvent` filtered by paymaster + relayer EOA balance deltas | Paymaster + relayer spend over time, USD-converted, broken out by op type |
| **DeFi** | Tezcatli vault `Deposit` / `Withdraw` events | Per-vault TVL, principal vs yield, active position count |
| **Bridge** | Circle CCTP `DepositForBurn` filtered by Z0tz stealths | Cross-chain volume + source→destination flow |

## Data sources

The dashboard reads chain events directly via viem. Contract addresses come from the Z0tz repo's `contracts/deployments/v6.5-ledger-{chainId}.json` and `contracts/deployments/fullstack-{chainId}.json` files, copied into `lib/addresses.ts` at build time.

Event scans are cached in-process for the lifetime of a serverless invocation. For sustained traffic, wire up Vercel KV or Upstash Redis and replace `lib/cache.ts`'s in-memory map.

## RPC strategy

Mirrors the Z0tz relayer's pool resolver:
- Primary: `RPC_URL_{chainId}` env var if set.
- Fallback pool: official L1/L2 RPCs → drpc → tenderly → publicnode.
- viem `fallback` transport rotates on any error.

## Auth

Single-admin HTTP Basic Auth via Next middleware. `ADMIN_USER` + `ADMIN_PASS` env vars, constant-time compare in middleware (no bcrypt — single secret, server-side only). Add NextAuth later if multi-admin is needed.

## License

Apache-2.0 — internal Z0tz tooling.
