import { CHAIN_IDS, type SupportedChainId } from "./rpc";

const EXPLORER_BASE: Record<SupportedChainId, string> = {
  [CHAIN_IDS.BASE_SEPOLIA]: "https://sepolia.basescan.org",
  [CHAIN_IDS.ETH_SEPOLIA]: "https://sepolia.etherscan.io",
  [CHAIN_IDS.ARB_SEPOLIA]: "https://sepolia.arbiscan.io",
};

const EXPLORER_NAME: Record<SupportedChainId, string> = {
  [CHAIN_IDS.BASE_SEPOLIA]: "BaseScan",
  [CHAIN_IDS.ETH_SEPOLIA]: "Etherscan",
  [CHAIN_IDS.ARB_SEPOLIA]: "Arbiscan",
};

export function txUrl(chainId: SupportedChainId, hash: string): string {
  return `${EXPLORER_BASE[chainId]}/tx/${hash}`;
}

export function addressUrl(chainId: SupportedChainId, address: string): string {
  return `${EXPLORER_BASE[chainId]}/address/${address}`;
}

export function explorerName(chainId: SupportedChainId): string {
  return EXPLORER_NAME[chainId];
}
