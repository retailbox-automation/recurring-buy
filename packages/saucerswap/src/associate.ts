import { type Hex, encodeFunctionData, parseAbi } from "viem";

/** HIP-719 functions that every HTS token answers at its own address, for `msg.sender`. */
export const hip719Abi = parseAbi([
  "function associate() returns (int64)",
  "function dissociate() returns (int64)",
  "function isAssociated() view returns (bool)",
]);

/**
 * Calldata for HIP-719 `associate()`: send it to the token's address from the account to associate. It used 726,488
 * gas, 0.79 HBAR, on testnet (docs/testnet-findings.md, A1).
 */
export const associateCalldata = (): Hex => encodeFunctionData({ abi: hip719Abi, functionName: "associate" });
