// calibra/src/lib/calibraOnchain.ts
import { keccak256, toBytes, type Address, type Hex } from "viem";

export const ADI_TESTNET_CHAIN_ID = 99999;

export const CALIBRA_PROTOCOL =
  "0x2efe9ae023241Df74A1A79d64b8CA3acfC9d7a25" as Address;

export const MOCK_USDC =
  "0xa014Dab469Eb138aa0072129458067aCd1688240" as Address;

export function batchIdToHash(batchId: string): Hex {
  return keccak256(toBytes(batchId)) as Hex;
}

export const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const CALIBRA_PROTOCOL_ABI = [
  {
    type: "function",
    name: "getBatch",
    stateMutability: "view",
    inputs: [{ name: "batchIdHash", type: "bytes32" }],
    outputs: [
      { name: "exists", type: "bool" },
      { name: "operator", type: "address" },
      { name: "funder", type: "address" },
      { name: "windowStart", type: "uint64" },
      { name: "windowEnd", type: "uint64" },
      { name: "revealDeadline", type: "uint64" },
      { name: "seedHash", type: "bytes32" },
      { name: "seedRevealed", type: "bool" },
      { name: "mixBlockNumber", type: "uint64" },
      { name: "randomness", type: "bytes32" },
      { name: "specHash", type: "bytes32" },
      { name: "funded", type: "bool" },
      { name: "finalized", type: "bool" },
      { name: "bounty", type: "uint256" },
      { name: "joinBond", type: "uint256" },
      { name: "refundTopBP", type: "uint16" },
      { name: "funderEncryptPubKeyHash", type: "bytes32" },
      { name: "minCommitsPerProvider", type: "uint32" },
      { name: "maxCommitsPerProvider", type: "uint32" },
      { name: "requireRevealAllCommits", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getProviderSummary",
    stateMutability: "view",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "provider", type: "address" },
    ],
    outputs: [
      { name: "joined", type: "bool" },
      { name: "joinedAt", type: "uint64" },
      { name: "commitCount", type: "uint32" },
      { name: "revealedCount", type: "uint32" },
      { name: "lastCommitAt", type: "uint64" },
      { name: "bond", type: "uint256" },
      { name: "bondSettled", type: "bool" },
      { name: "payout", type: "uint256" },
      { name: "payoutClaimed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getCommitCount",
    stateMutability: "view",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "provider", type: "address" },
    ],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "getCommit",
    stateMutability: "view",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "provider", type: "address" },
      { name: "commitIndex", type: "uint32" },
    ],
    outputs: [
      { name: "commitHash", type: "bytes32" },
      { name: "committedAt", type: "uint64" },
      { name: "revealed", type: "bool" },
      { name: "root", type: "bytes32" },
      { name: "salt", type: "bytes32" },
      { name: "publicUriHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "getSelectedCommitIndex",
    stateMutability: "view",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "provider", type: "address" },
    ],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "join",
    stateMutability: "nonpayable",
    inputs: [{ name: "batchIdHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "commitHash", type: "bytes32" },
      { name: "encryptedUriHash", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revealCommits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchIdHash", type: "bytes32" },
      { name: "commitIndices", type: "uint32[]" },
      { name: "roots", type: "bytes32[]" },
      { name: "salts", type: "bytes32[]" },
      { name: "publicUris", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;
