import { cached } from "./cache";

/**
 * ETH spot price in USD. CoinGecko free tier is rate-limited (~30 req/min).
 * We cache for 5 minutes so a serverless burst doesn't blow the quota.
 */
export async function getEthPriceUsd(): Promise<number> {
  return cached("ethPrice", 300, async () => {
    const key = process.env.COINGECKO_API_KEY;
    const url = key
      ? `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&x_cg_demo_api_key=${key}`
      : "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
    try {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) return 0;
      const data = (await res.json()) as { ethereum?: { usd?: number } };
      return data.ethereum?.usd ?? 0;
    } catch {
      return 0;
    }
  });
}
