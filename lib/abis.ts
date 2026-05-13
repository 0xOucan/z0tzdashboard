/**
 * Minimal event + read ABIs for the contracts the dashboard watches.
 */
import type { Abi } from "viem";

export const SWEEPER_ABI = [
  {
    type: "event",
    name: "PrivateSweep",
    inputs: [
      { name: "stealthAddress", type: "address", indexed: true },
      { name: "wrappedTokenOrVault", type: "address", indexed: true },
      { name: "shieldedAmount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const LEDGER_ABI = [
  {
    type: "event",
    name: "CreditedFromVault",
    inputs: [
      { name: "ledgerId", type: "bytes32", indexed: true },
      { name: "netAmount", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Spent",
    inputs: [
      { name: "oldId", type: "bytes32", indexed: true },
      { name: "newId", type: "bytes32", indexed: true },
      { name: "action", type: "uint8", indexed: false },
    ],
  },
] as const satisfies Abi;

export const ENTRY_POINT_ABI = [
  {
    type: "event",
    name: "UserOperationEvent",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "paymaster", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "actualGasCost", type: "uint256", indexed: false },
      { name: "actualGasUsed", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const ERC20_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const satisfies Abi;

export const CCTP_ABI = [
  {
    type: "event",
    name: "DepositForBurn",
    inputs: [
      { name: "nonce", type: "uint64", indexed: true },
      { name: "burnToken", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "depositor", type: "address", indexed: true },
      { name: "mintRecipient", type: "bytes32", indexed: false },
      { name: "destinationDomain", type: "uint32", indexed: false },
      { name: "destinationTokenMessenger", type: "bytes32", indexed: false },
      { name: "destinationCaller", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

export const ENTRY_POINT_DEPOSIT_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// Tezcatli confidential DeFi
// ---------------------------------------------------------------------------

export const TEZCATLI_VAULT_ABI = [
  {
    type: "event",
    name: "DepositRecorded",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "beneficiary", type: "address", indexed: true },
      // euint64 — on chain just a uint256 handle, amount itself FHE-encrypted
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalExecuted",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StrategyDeployed",
    inputs: [
      { name: "adapter", type: "address", indexed: true },
      { name: "assets", type: "uint64", indexed: false },
      { name: "sharesOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StrategyRedeemed",
    inputs: [
      { name: "adapter", type: "address", indexed: true },
      { name: "sharesIn", type: "uint256", indexed: false },
      { name: "assetsOut", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const TEZCATLI_AAVE_ADAPTER_ABI = [
  {
    type: "event",
    name: "DeployedToAave",
    inputs: [
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedeemedFromAave",
    inputs: [
      { name: "shares", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "aToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// Compliance gate (FHEIP-0010)
// ---------------------------------------------------------------------------

export const COMPLIANCE_GATE_ABI = [
  {
    type: "event",
    name: "Screened",
    inputs: [
      { name: "uuid", type: "bytes32", indexed: true },
      { name: "action", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "periodTag", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "allowed", type: "bool", indexed: false },
      { name: "reasonCode", type: "uint8", indexed: false },
      { name: "policyVersion", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Blacklisted",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "reasonCode", type: "uint8", indexed: false },
      { name: "policyVersion", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Whitelisted",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "policyVersion", type: "uint64", indexed: false },
    ],
  },
  {
    type: "function",
    name: "enabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "requireKyc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "policyVersion",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const satisfies Abi;

export const KYC_REGISTRY_ABI = [
  {
    type: "event",
    name: "KycAttested",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "expiresAt", type: "uint64", indexed: false },
      { name: "attestor", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "KycRevoked",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "attestor", type: "address", indexed: true },
    ],
  },
] as const satisfies Abi;

export const OFAC_ORACLE_ABI = [
  {
    type: "event",
    name: "Sanctioned",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "referenceHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Unsanctioned",
    inputs: [{ name: "account", type: "address", indexed: true }],
  },
  {
    type: "function",
    name: "isSanctioned",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

export const DEPOSITOR_REGISTRY_ABI = [
  {
    type: "event",
    name: "DepositRecorded",
    inputs: [
      { name: "depositor", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "periodTag", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// Stealth meta-contracts (ERC-5564 / ERC-6538)
// ---------------------------------------------------------------------------

export const STEALTH_ANNOUNCER_ABI = [
  {
    type: "event",
    name: "Announcement",
    inputs: [
      { name: "schemeId", type: "uint256", indexed: true },
      { name: "stealthAddress", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "ephemeralPubKey", type: "bytes", indexed: false },
      { name: "metadata", type: "bytes", indexed: false },
    ],
  },
] as const satisfies Abi;
