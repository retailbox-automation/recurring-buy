import { type Address, type Hex, decodeFunctionData, encodeFunctionData, parseAbi } from "viem";

import { type SwapPath, decodePath } from "./path.js";

/** The part of SaucerSwapV2SwapRouter this package uses. */
export const routerAbi = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function refundETH() payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export type ExactInputParams = {
  path: Hex;
  recipient: Address;
  /** Unix seconds; the router reverts after it. */
  deadline: bigint;
  /** In the first token's smallest unit: tinybar for WHBAR. */
  amountIn: bigint;
  amountOutMinimum: bigint;
};

/** The relay counts HBAR in weibar (18 decimals), HBAR itself has 8: 1 tinybar is 10^10 weibar. */
export const tinybarToWeibar = (tinybar: bigint): bigint => tinybar * 10_000_000_000n;

/**
 * A token to another token: a plain `exactInput`. The sender must be associated with the path's first token and have
 * approved the router for `amountIn`.
 */
export const buildSwapFromTokenCalldata = (params: ExactInputParams): Hex =>
  encodeFunctionData({ abi: routerAbi, functionName: "exactInput", args: [params] });

/**
 * HBAR to a token, as in SaucerSwap's "Swap exact HBAR for tokens" example: `multicall[exactInput, refundETH]`, sent
 * with `amountIn` of HBAR as its value (`valueWeibar`). `refundETH` returns the HBAR the swap did not use.
 */
export function buildSwapFromHbarCalldata(params: ExactInputParams): { data: Hex; valueWeibar: bigint } {
  const swap = buildSwapFromTokenCalldata(params);
  const refund = encodeFunctionData({ abi: routerAbi, functionName: "refundETH" });
  const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[swap, refund]] });
  return { data, valueWeibar: tinybarToWeibar(params.amountIn) };
}

export type DecodedSwapCall =
  | {
      functionName: "exactInput";
      path: SwapPath;
      recipient: Address;
      deadline: bigint;
      amountIn: bigint;
      amountOutMinimum: bigint;
      valueWeibar: bigint;
    }
  | { functionName: "refundETH" }
  | { functionName: "multicall"; calls: DecodedSwapCall[] };

/**
 * Router calldata as plain values, to show what a transaction will do before it is signed: a wallet reports success
 * even when a scheduled swap reverts (docs/testnet-findings.md, A4 and A12). Throws on calldata that is not a router
 * call.
 */
export function describeSwapCalldata(data: Hex): DecodedSwapCall {
  const decoded = decodeFunctionData({ abi: routerAbi, data });
  if (decoded.functionName === "multicall") {
    return { functionName: "multicall", calls: decoded.args[0].map(describeSwapCalldata) };
  }
  if (decoded.functionName === "refundETH") {
    return { functionName: "refundETH" };
  }
  const params = decoded.args[0];
  return {
    functionName: "exactInput",
    path: decodePath(params.path),
    // viem decodes addresses checksummed; every other address in this package is lowercase.
    recipient: params.recipient.toLowerCase() as Address,
    deadline: params.deadline,
    amountIn: params.amountIn,
    amountOutMinimum: params.amountOutMinimum,
    valueWeibar: tinybarToWeibar(params.amountIn),
  };
}
