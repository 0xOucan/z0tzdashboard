import { PageHeader } from "@/components/PageHeader";
import { ChainBadge } from "@/components/ChainBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ADDRESSES, type Z0tzAddresses } from "@/lib/addresses";
import { SUPPORTED_CHAINS, CHAIN_META, type SupportedChainId } from "@/lib/rpc";
import { explorerName } from "@/lib/explorer";

export const dynamic = "force-dynamic";

type ContractRow = {
  label: string;
  key: keyof Z0tzAddresses;
  description: string;
  group: "core" | "tokens" | "infra" | "tezcatli" | "compliance" | "stealth" | "bridge";
};

const ROWS: ContractRow[] = [
  // V6.5 core ledger stack
  {
    label: "PrivateLedger",
    key: "ledger",
    description: "Encrypted balance store keyed by pseudonymous ledger IDs",
    group: "core",
  },
  {
    label: "PrivateLedgerVault",
    key: "vault",
    description: "FHERC20 shield/unshield boundary",
    group: "core",
  },
  {
    label: "PrivateSweeperV2",
    key: "sweeper",
    description: "Stealth → vault → ledger sweep gate (1% fee, sweepNonceV2 multi-sweep)",
    group: "core",
  },

  // Tokens
  { label: "USDC", key: "usdc", description: "Underlying ERC-20 USDC", group: "tokens" },
  {
    label: "wrappedUsdc (FHERC20)",
    key: "wrappedUsdc",
    description: "Confidential ciphertext wrapper around USDC",
    group: "tokens",
  },

  // Infra
  {
    label: "EntryPoint v0.8",
    key: "entryPoint",
    description: "ERC-4337 EntryPoint (canonical address)",
    group: "infra",
  },
  {
    label: "Paymaster",
    key: "paymaster",
    description: "Z0tz paymaster — sponsors all UserOp gas (1% token fee)",
    group: "infra",
  },
  {
    label: "AccountFactory",
    key: "accountFactory",
    description: "CREATE2 factory for Z0tz smart accounts",
    group: "infra",
  },
  {
    label: "Account Implementation",
    key: "accountImpl",
    description: "UUPS implementation behind every smart account",
    group: "infra",
  },
  {
    label: "RecoveryModule Implementation",
    key: "recoveryModuleImpl",
    description: "Guardian-based recovery module (per-account proxy)",
    group: "infra",
  },
  {
    label: "Relayer EOA",
    key: "relayerWallet",
    description: "Off-chain relayer signer / stealth funder (same address on all chains)",
    group: "infra",
  },
  {
    label: "Treasury",
    key: "treasury",
    description: "Sweeper fee recipient + paymaster operator",
    group: "infra",
  },

  // Tezcatli confidential DeFi
  {
    label: "Tezcatli Vault",
    key: "tezcatliVault",
    description: "Confidential USDC vault — Aave V3 strategy where deployed",
    group: "tezcatli",
  },
  {
    label: "Tezcatli Wrapper (tzcUSDC)",
    key: "tezcatliWrapped",
    description: "Confidential wrapper used by the Tezcatli vault",
    group: "tezcatli",
  },
  {
    label: "Tezcatli Aave Adapter",
    key: "tezcatliStrategyAdapter",
    description: "Strategy adapter that pushes idle USDC into Aave V3 (arb-sepolia only)",
    group: "tezcatli",
  },
  {
    label: "Tezcatli VaultFactory",
    key: "tezcatliVaultFactory",
    description: "Factory that deploys per-asset Tezcatli vaults",
    group: "tezcatli",
  },
  {
    label: "Tezcatli RiskPolicy",
    key: "tezcatliRiskPolicy",
    description: "Per-vault risk parameters (caps, lock options, fees)",
    group: "tezcatli",
  },

  // Compliance (FHEIP-0010)
  {
    label: "ComplianceGate",
    key: "complianceGate",
    description: "FHEIP-0010 gate — composes KYC + OFAC + depositor registry",
    group: "compliance",
  },
  {
    label: "KYC Registry",
    key: "kycRegistry",
    description: "Per-address KYC attestation (default-permissive on testnet)",
    group: "compliance",
  },
  {
    label: "OFAC Oracle",
    key: "ofacOracle",
    description: "Sanctions blocklist consulted in canShield / canUnshield",
    group: "compliance",
  },
  {
    label: "DepositorRegistry",
    key: "depositorRegistry",
    description: "Append-only audit trail of every screened depositor",
    group: "compliance",
  },

  // Stealth meta-contracts
  {
    label: "StealthRegistry",
    key: "stealthRegistry",
    description: "ERC-6538: maps account → stealth meta-address",
    group: "stealth",
  },
  {
    label: "StealthAnnouncer",
    key: "stealthAnnouncer",
    description: "ERC-5564: stealth payment announcements",
    group: "stealth",
  },

  // Bridges
  {
    label: "Z0tzBridge (mock USDC)",
    key: "bridge",
    description: "V6 mock USDC bridge — superseded by Circle CCTP for real USDC",
    group: "bridge",
  },
  {
    label: "CCTP TokenMessenger V2",
    key: "cctpTokenMessenger",
    description: "Circle's permissionless USDC bridge entrypoint",
    group: "bridge",
  },
];

const GROUP_LABEL: Record<ContractRow["group"], string> = {
  core: "Core V6.5 ledger stack",
  tokens: "Tokens",
  infra: "ERC-4337 infrastructure + operational identities",
  tezcatli: "Tezcatli confidential DeFi",
  compliance: "Compliance gate (FHEIP-0010)",
  stealth: "Stealth meta-contracts",
  bridge: "Bridges",
};

const GROUP_ORDER: ContractRow["group"][] = [
  "core",
  "tokens",
  "infra",
  "tezcatli",
  "compliance",
  "stealth",
  "bridge",
];

const ZERO = "0x0000000000000000000000000000000000000000";

export default function ContractsPage() {
  const totalContracts = SUPPORTED_CHAINS.reduce((acc, chainId) => {
    const addrs = ADDRESSES[chainId];
    return (
      acc +
      ROWS.filter((r) => {
        const v = addrs[r.key] as string | null;
        return v !== null && v !== ZERO;
      }).length
    );
  }, 0);

  return (
    <div>
      <PageHeader
        title="Contracts"
        subtitle={`Every Z0tz contract on every chain — ${totalContracts} live addresses across 3 chains. One click to verify any number on the dashboard against on-chain truth.`}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        {SUPPORTED_CHAINS.map((chainId) => {
          const addrs = ADDRESSES[chainId];
          const liveCount = ROWS.filter((r) => {
            const v = addrs[r.key] as string | null;
            return v !== null && v !== ZERO;
          }).length;
          return (
            <div key={chainId} className="bg-bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <ChainBadge chainId={chainId} />
                <span className="text-xs text-text-muted">via {explorerName(chainId)}</span>
              </div>
              <div className="text-xs text-text-muted">
                {CHAIN_META[chainId].name} · chainId {chainId} · {liveCount}/{ROWS.length} contracts
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-6">
        {GROUP_ORDER.map((group) => {
          const groupRows = ROWS.filter((r) => r.group === group);
          if (groupRows.length === 0) return null;
          return (
            <div key={group} className="bg-bg-card border border-border rounded-lg p-5">
              <h3 className="font-medium mb-4">{GROUP_LABEL[group]}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                    <th className="pb-2 font-normal w-1/4">Contract</th>
                    <th className="pb-2 font-normal w-2/5">Description</th>
                    {SUPPORTED_CHAINS.map((chainId) => (
                      <th key={chainId} className="pb-2 font-normal">
                        <ChainBadge chainId={chainId} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="py-3 font-medium">{row.label}</td>
                      <td className="py-3 text-xs text-text-muted">{row.description}</td>
                      {SUPPORTED_CHAINS.map((chainId) => {
                        const addr = ADDRESSES[chainId][row.key] as string | null;
                        if (!addr || addr === ZERO) {
                          return (
                            <td key={chainId} className="py-3 text-xs text-text-subtle">
                              not deployed
                            </td>
                          );
                        }
                        return (
                          <td key={chainId} className="py-3">
                            <ExplorerLink chainId={chainId} value={addr} type="address" />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="mt-6 text-xs text-text-muted">
        Source of truth:{" "}
        <span className="font-mono">
          /Z0tz/contracts/deployments/v6.5-ledger-&#123;chainId&#125;.json
        </span>{" "}
        ·{" "}
        <span className="font-mono">fullstack-&#123;chainId&#125;.json</span> ·{" "}
        <span className="font-mono">defi-vaults.json</span>. Sync{" "}
        <code>lib/addresses.ts</code> after any Z0tz redeploy.
      </div>
    </div>
  );
}
