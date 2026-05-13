/**
 * Z0tz contract addresses per chain. Source of truth:
 *   /home/oucan/EVVM/FHE/Z0tz/contracts/deployments/v6.5-ledger-{chainId}.json
 *   /home/oucan/EVVM/FHE/Z0tz/contracts/deployments/fullstack-{chainId}.json
 *   /home/oucan/EVVM/FHE/Z0tz/contracts/deployments/defi-vaults.json
 *
 * Re-sync this file by hand after any Z0tz redeploy. Inlining the addresses
 * keeps the dashboard build self-contained and decouples deploys.
 */
import type { Address } from "viem";
import { CHAIN_IDS, type SupportedChainId } from "./rpc";

export type Z0tzAddresses = {
  // V6.5 core ledger stack
  ledger: Address;
  vault: Address;
  sweeper: Address;
  paymaster: Address;

  // Tokens
  wrappedUsdc: Address;
  usdc: Address;

  // ERC-4337 infrastructure
  entryPoint: Address;
  accountFactory: Address | null;
  accountImpl: Address | null;
  recoveryModuleImpl: Address | null;

  // Operational identities
  relayerWallet: Address;
  treasury: Address;

  // Tezcatli confidential DeFi
  tezcatliVault: Address | null;
  tezcatliWrapped: Address | null;
  tezcatliStrategyAdapter: Address | null;
  tezcatliVaultFactory: Address | null;
  tezcatliRiskPolicy: Address | null;

  // Compliance (FHEIP-0010)
  complianceGate: Address | null;
  kycRegistry: Address | null;
  ofacOracle: Address | null;
  depositorRegistry: Address | null;

  // Stealth meta-contracts
  stealthRegistry: Address | null;
  stealthAnnouncer: Address | null;

  // Mock USDC bridge (V6 legacy — still on chain)
  bridge: Address | null;

  // CCTP TokenMessenger V2 (canonical across CCTP-supported chains)
  cctpTokenMessenger: Address;
};

export const ADDRESSES: Record<SupportedChainId, Z0tzAddresses> = {
  // ---------------------------------------------------------------------------
  // Base Sepolia (84532) — full v6.5 + tezcatli + compliance
  // ---------------------------------------------------------------------------
  [CHAIN_IDS.BASE_SEPOLIA]: {
    ledger: "0xD912e777811238F14106F4Fb161230Bb182dAF4e",
    vault: "0x308fbdc8aaD5e5Ee470Adb1A89072a31CbDa3829",
    sweeper: "0xF1368C62986F1681aEb370E796cdcf8f18635E8c",
    paymaster: "0x06251350e80b13B460e7A8e7AAaceEc960c71179",

    wrappedUsdc: "0x9958E68b93a40035Cfc82d801818B8269282e191",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",

    entryPoint: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    accountFactory: "0xe67471E72647E6088791a0f752628D910Dc4D94b",
    accountImpl: "0x5cAf6D1299fA05cf87C82F475a6515b976A3030c",
    recoveryModuleImpl: "0xdC7e5DA1Ea13921541da59527a78bC00F68a6389",

    relayerWallet: "0x843914e5BBdbE92296F2c3D895D424301b3517fC",
    treasury: "0x9c77c6fafc1eb0821F1De12972Ef0199C97C6e45",

    tezcatliVault: "0x1Bc118f117dC7D75603ab4CD11B6904Be0df4623",
    tezcatliWrapped: "0xeb571Fb31DcB7713bf83CdcF137003c852089eE8",
    tezcatliStrategyAdapter: null, // no Aave on base-sepolia
    tezcatliVaultFactory: "0xA9d7BCd5651Ca187D631409812841498e8971b63",
    tezcatliRiskPolicy: "0xC86B11268A9e617d3Fc17FcE2150ce17132285cc",

    complianceGate: "0x850ab4D863ab20c6F5494D337F08887DC9148013",
    kycRegistry: "0xf93CF605Ec9cCFC42e08DCD9598B606feF754873",
    ofacOracle: "0x2D3D962e69C38D36729294A55933AFcC108a2d26",
    depositorRegistry: "0xaDdF6aA9df9B99b013a35E44eABD6240ceDC4ba5",

    stealthRegistry: "0x5D95785Ead234D3Cf90cDfed2609346aECa217aD",
    stealthAnnouncer: "0x14655ba23f11FAaBd310703CAc387a69429cb7C8",

    bridge: "0xF1118A2E237f544a9bab086734Ca3e34c2e62068",

    cctpTokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },

  // ---------------------------------------------------------------------------
  // Eth Sepolia (11155111) — full v6.5 + tezcatli + compliance
  // ---------------------------------------------------------------------------
  [CHAIN_IDS.ETH_SEPOLIA]: {
    ledger: "0x60570F2DeA11A09B5c6411A8f48017F50eFc4D6C",
    vault: "0x763BC9f2F6520E92B4D56622F55F370D3bF1bF3F",
    sweeper: "0x9BA45877b983a0c704dA37b50cd5e746e66E5F66",
    paymaster: "0x4bcb7C436A479909E32Cb699B4901246ECffD064",

    wrappedUsdc: "0x9aBE44788694C114DA14abb4765F0B76b162DD6F",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",

    entryPoint: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    accountFactory: "0x68f673159Ca6791Fd90a9abc183dcf85caD5B431",
    accountImpl: "0xC877Da43F33f5aF674E15d8f9C979f40EE6eCFe2",
    recoveryModuleImpl: "0x03A9919a24544d36F72eC55259F4a9fe20850f58",

    relayerWallet: "0x843914e5BBdbE92296F2c3D895D424301b3517fC",
    treasury: "0x9c77c6fafc1eb0821F1De12972Ef0199C97C6e45",

    tezcatliVault: "0xA90957B6D8475c09906Cd91735995D222ea78F40",
    tezcatliWrapped: "0xa6f051D55Af5AF7F39643064A41ACEC355Aa9A71",
    tezcatliStrategyAdapter: null, // no Aave on eth-sepolia
    tezcatliVaultFactory: "0x4eA32dEb7EB710981C14eb71ff2afCCbC0849FfE",
    tezcatliRiskPolicy: "0x1b697D1950961d03ed09Bb9D5199a69923F7Ae6C",

    complianceGate: "0x8575E390aA8052d32A3208199B2b0f494c943420",
    kycRegistry: "0x544C8a38b7Ef4fbc5a88D24ea6F798B9dc5A139C",
    ofacOracle: "0x7Bb1370bf477B3FbB15Fa0C69410459991F09f98",
    depositorRegistry: "0x0596de86a8E9CEFe45b62d6a3610a55eC5f29023",

    stealthRegistry: "0xa7B9d114029eB345250c4b08AE35F6951D10e179",
    stealthAnnouncer: "0x6E7CECeF5DcE175BB2023e57a9c1D653c91c3412",

    bridge: "0xd593fcb05538bEd627b49f4EB79F4fa861139607",

    cctpTokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },

  // ---------------------------------------------------------------------------
  // Arb Sepolia (421614) — full v6.5 + tezcatli + Aave adapter + compliance
  // ---------------------------------------------------------------------------
  [CHAIN_IDS.ARB_SEPOLIA]: {
    ledger: "0x1b45Da2D95ad8180D60616b668F44AC8dc457504",
    vault: "0x2B147275C63aFDF8583A4bce53c49100fE171CAC",
    sweeper: "0x0fb0CC4eedfA2f93729cD16Cd2F553A617e56D5A",
    paymaster: "0xA0aC4aBa7CD26f72C9D4b3979Fe8555e95E3667A",

    wrappedUsdc: "0xF336F0C79A462051d07aD7e795Cc83e9e5E5eB61",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",

    entryPoint: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    accountFactory: "0xeb571Fb31DcB7713bf83CdcF137003c852089eE8",
    accountImpl: "0xc355949f12CB65791e2927C6C3Aa55dF4b6B8cd7",
    recoveryModuleImpl: "0x964a3DA97683b2Aad5A4F90388606Df7B91BC5B1",

    relayerWallet: "0x843914e5BBdbE92296F2c3D895D424301b3517fC",
    treasury: "0x9c77c6fafc1eb0821F1De12972Ef0199C97C6e45",

    tezcatliVault: "0x90638B32b20e7BeDdb5AEFD745bF7a86b78a5A78",
    tezcatliWrapped: "0x14655ba23f11FAaBd310703CAc387a69429cb7C8",
    // Live Aave V3 adapter — defi-vaults.json is authoritative over fullstack-*.json
    // (fullstack-421614.json still has `aaveAdapter: null` because it was set
    // post-deploy via setStrategy on the vault).
    tezcatliStrategyAdapter: "0xfE573D24eca408B9c5fCf066f66BB57081777A55",
    tezcatliVaultFactory: "0xf93CF605Ec9cCFC42e08DCD9598B606feF754873",
    tezcatliRiskPolicy: "0x2D3D962e69C38D36729294A55933AFcC108a2d26",

    complianceGate: "0xe08942c436874411161Fe76E628C91Daf9e2dcd6",
    kycRegistry: "0xBb7948e571996EBA66f949059dA7ad91868CD0aa",
    ofacOracle: "0x27c2209950de1bef0e33C0509542700bB63F74d6",
    depositorRegistry: "0xDEB54DB41b77143B3Eb96e12c38411D42DBa6B46",

    stealthRegistry: "0x292afA5cEFB8739a83571A3e7ec91D047D11cD35",
    stealthAnnouncer: "0xF7bB09AF799F7451821664cc99F65C4148E1a700",

    bridge: "0x483722349eB8a92Dcc9bD27fb5d07Bfac51aCAf7",

    cctpTokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
};

/**
 * Fallback lookback used only when both SCAN_FROM_BLOCK_{chainId} env override
 * AND the V6.5 deployment-block binary search (lib/deployment.ts) are
 * unavailable. The normal scan floor is the deployment block itself —
 * `lib/scanner.ts.getScanRange` prefers it over these constants.
 */
export const DEFAULT_LOOKBACK_BLOCKS: Record<SupportedChainId, bigint> = {
  [CHAIN_IDS.BASE_SEPOLIA]: 50_000n, // ~28 hours at 2s blocks
  [CHAIN_IDS.ETH_SEPOLIA]: 10_000n, // ~33 hours at 12s blocks
  [CHAIN_IDS.ARB_SEPOLIA]: 500_000n, // ~35 hours at 0.25s blocks
};

/**
 * Soft cap on events returned per (contract, scan) — once collected, the
 * tail-first scanner short-circuits even if there's more history. Override
 * via SCAN_MAX_EVENTS env var. 1000 is plenty for testnet; raise for prod.
 */
export const MAX_EVENTS_PER_SOURCE = Number(process.env.SCAN_MAX_EVENTS ?? "1000");

export function scanFromBlockOverride(chainId: SupportedChainId): bigint | null {
  const raw = process.env[`SCAN_FROM_BLOCK_${chainId}`];
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}
