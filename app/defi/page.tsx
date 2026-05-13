import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { publicClient } from "@/lib/chains";
import { ADDRESSES } from "@/lib/addresses";
import { ERC20_ABI } from "@/lib/abis";
import { SUPPORTED_CHAINS, CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { fmtUsdc, fmtCompact } from "@/lib/format";
import { cached } from "@/lib/cache";
import { getTezcatliVaultActivity, getAaveAdapterSnapshot } from "@/lib/tezcatli";
import { Coins, Sparkles, TrendingUp, ArrowRightLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";
export const revalidate = 60;

type VaultSnapshot = {
  chainId: SupportedChainId;
  vault: `0x${string}`;
  wrapped: `0x${string}` | null;
  hasStrategy: boolean;
  underlyingBalance: bigint;
  wrapperReserveOnVault: bigint;
};

async function loadVaultSnapshots(): Promise<VaultSnapshot[]> {
  return cached("vaults", 60, async () => {
    const out: VaultSnapshot[] = [];
    await Promise.all(
      SUPPORTED_CHAINS.map(async (chainId) => {
        const addr = ADDRESSES[chainId];
        if (!addr.tezcatliVault) return;
        const client = publicClient(chainId);
        try {
          const [usdcInWrapper, wrappedOnVault] = await Promise.all([
            addr.tezcatliWrapped
              ? client.readContract({
                  address: addr.usdc,
                  abi: ERC20_ABI,
                  functionName: "balanceOf",
                  args: [addr.tezcatliWrapped],
                })
              : Promise.resolve(0n),
            addr.tezcatliWrapped
              ? client.readContract({
                  address: addr.tezcatliWrapped,
                  abi: ERC20_ABI,
                  functionName: "balanceOf",
                  args: [addr.tezcatliVault],
                })
              : Promise.resolve(0n),
          ]);
          out.push({
            chainId,
            vault: addr.tezcatliVault!,
            wrapped: addr.tezcatliWrapped,
            hasStrategy: addr.tezcatliStrategyAdapter !== null,
            underlyingBalance: usdcInWrapper as bigint,
            wrapperReserveOnVault: wrappedOnVault as bigint,
          });
        } catch (err) {
          console.warn(`vault snapshot ${chainId} failed:`, (err as Error).message);
        }
      })
    );
    return out;
  });
}

export default async function DefiPage() {
  const [snapshots, activity, adapters] = await Promise.all([
    loadVaultSnapshots(),
    getTezcatliVaultActivity(),
    getAaveAdapterSnapshot(),
  ]);

  const totalUnderlying = snapshots.reduce((acc, s) => acc + s.underlyingBalance, 0n);
  const totalReserve = snapshots.reduce((acc, s) => acc + s.wrapperReserveOnVault, 0n);
  const productiveVaults = snapshots.filter((s) => s.hasStrategy).length;
  const totalDeposits = activity.reduce((acc, a) => acc + a.deposits, 0);
  const totalWithdrawals = activity.reduce((acc, a) => acc + a.withdrawals, 0);
  const totalStrategyDeployed = activity.reduce((acc, a) => acc + a.strategyDeployed, 0n);
  const totalStrategyRedeemed = activity.reduce((acc, a) => acc + a.strategyRedeemed, 0n);
  const totalATokenBalance = adapters.reduce((acc, a) => acc + a.aTokenBalance, 0n);
  const totalAaveYield =
    totalStrategyDeployed > 0n && totalATokenBalance > totalStrategyDeployed - totalStrategyRedeemed
      ? totalATokenBalance - (totalStrategyDeployed - totalStrategyRedeemed)
      : 0n;

  return (
    <div>
      <PageHeader
        title="DeFi"
        subtitle="Tezcatli confidential vaults across 3 chains. Plaintext underlying at the wrapper · Aave V3 strategy on arb-sepolia."
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Vaults online"
          value={String(snapshots.length)}
          sublabel={`${productiveVaults} with Aave strategy`}
          tone="green"
          icon={<Coins className="w-4 h-4" />}
        />
        <KpiCard
          label="Deposit/withdraw count"
          value={`${totalDeposits}/${totalWithdrawals}`}
          sublabel="All-time confidential ops"
          tone="blue"
          icon={<ArrowRightLeft className="w-4 h-4" />}
        />
        <KpiCard
          label="In Aave V3 (aUSDC)"
          value={fmtUsdc(totalATokenBalance)}
          sublabel={`Net deployed: ${fmtUsdc(totalStrategyDeployed - totalStrategyRedeemed)} USDC`}
          tone={totalATokenBalance > 0n ? "green" : "neutral"}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          label="Yield accrued"
          value={fmtUsdc(totalAaveYield)}
          sublabel="aUSDC − net principal"
          tone="amber"
          icon={<Sparkles className="w-4 h-4" />}
        />
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <h3 className="font-medium mb-1">Tezcatli vaults</h3>
        <p className="text-xs text-text-muted mb-4">
          Encrypted shares per depositor live in the vault. Wrapper holds plaintext USDC not yet pushed to strategy.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Chain</th>
              <th className="pb-2 font-normal">Vault</th>
              <th className="pb-2 font-normal">Strategy</th>
              <th className="pb-2 font-normal text-right">USDC in wrapper</th>
              <th className="pb-2 font-normal text-right">tzcUSDC on vault</th>
              <th className="pb-2 font-normal text-right">Deposits / Withdrawals</th>
              <th className="pb-2 font-normal text-right">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => {
              const act = activity.find((a) => a.chainId === s.chainId);
              return (
                <tr key={s.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={s.chainId} />
                  </td>
                  <td className="py-3">
                    <ExplorerLink chainId={s.chainId} value={s.vault} type="address" />
                  </td>
                  <td className="py-3">
                    {s.hasStrategy ? (
                      <span className="text-accent-green text-xs font-medium">Aave V3</span>
                    ) : (
                      <span className="text-text-muted text-xs">skeleton</span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums">{fmtUsdc(s.underlyingBalance)}</td>
                  <td className="py-3 text-right tabular-nums">{fmtUsdc(s.wrapperReserveOnVault)}</td>
                  <td className="py-3 text-right tabular-nums text-text-muted">
                    {act ? `${act.deposits} / ${act.withdrawals}` : "—"}
                  </td>
                  <td className="py-3 text-right text-xs text-text-muted">
                    {act && act.lastActivityTs > 0
                      ? formatDistanceToNow(new Date(act.lastActivityTs * 1000), { addSuffix: true })
                      : "never"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adapters.length > 0 && (
        <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-accent-green" />
            <h3 className="font-medium">Aave V3 strategy adapter</h3>
          </div>
          <p className="text-xs text-text-muted mb-4">
            Live aToken balance + idle underlying at the adapter. Yield = aToken − net principal deployed.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="pb-2 font-normal">Chain</th>
                <th className="pb-2 font-normal">Adapter</th>
                <th className="pb-2 font-normal">aToken</th>
                <th className="pb-2 font-normal text-right">aToken balance</th>
                <th className="pb-2 font-normal text-right">Idle USDC</th>
                <th className="pb-2 font-normal text-right">Total deployed (all-time)</th>
                <th className="pb-2 font-normal text-right">Total redeemed</th>
              </tr>
            </thead>
            <tbody>
              {adapters.map((a) => {
                const act = activity.find((x) => x.chainId === a.chainId);
                return (
                  <tr key={a.chainId} className="border-b border-border last:border-0">
                    <td className="py-3">
                      <ChainBadge chainId={a.chainId} />
                    </td>
                    <td className="py-3">
                      <ExplorerLink chainId={a.chainId} value={a.adapter} type="address" />
                    </td>
                    <td className="py-3">
                      {a.aToken ? (
                        <ExplorerLink chainId={a.chainId} value={a.aToken} type="address" />
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right tabular-nums">{fmtUsdc(a.aTokenBalance)}</td>
                    <td className="py-3 text-right tabular-nums">{fmtUsdc(a.underlyingInAdapter)}</td>
                    <td className="py-3 text-right tabular-nums text-text-muted">
                      {act ? fmtUsdc(act.strategyDeployed) : "—"}
                    </td>
                    <td className="py-3 text-right tabular-nums text-text-muted">
                      {act ? fmtUsdc(act.strategyRedeemed) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="font-medium mb-1">Strategy flow per chain</h3>
        <p className="text-xs text-text-muted mb-4">
          All-time USDC pushed to / pulled from Aave via the Tezcatli strategy adapter
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
              <th className="pb-2 font-normal">Chain</th>
              <th className="pb-2 font-normal text-right">Deployed → Aave</th>
              <th className="pb-2 font-normal text-right">Redeemed ← Aave</th>
              <th className="pb-2 font-normal text-right">Net in strategy</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((a) => {
              const net = a.strategyDeployed - a.strategyRedeemed;
              return (
                <tr key={a.chainId} className="border-b border-border last:border-0">
                  <td className="py-3">
                    <ChainBadge chainId={a.chainId} />
                  </td>
                  <td className="py-3 text-right tabular-nums">{fmtUsdc(a.strategyDeployed)}</td>
                  <td className="py-3 text-right tabular-nums">{fmtUsdc(a.strategyRedeemed)}</td>
                  <td className="py-3 text-right tabular-nums font-medium">{fmtUsdc(net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
