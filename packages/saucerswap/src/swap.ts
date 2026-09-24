import { type Address, type Hex, decodeFunctionData, encodeFunctionData, parseAbi } from "viem";

import { type SwapPath, decodePath } from "./path.js";

/** SaucerSwapV2SwapRouter — the subset of its Uniswap-V3-style interface this client uses. */
export const routerAbi = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function refundETH() payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export type ExactInputParams = {
  path: Hex;
  recipient: Address;
  /** Unix seconds. The router reverts after this even if a wrapping schedule executes later. */
  deadline: bigint;
  /** In the FIRST token's smallest unit (tinybar for HBAR/WHBAR — HBAR routes through WHBAR). */
  amountIn: bigint;
  amountOutMinimum: bigint;
};

/**
 * 1 tinybar = 1e10 weibar — the JSON-RPC relay reports `msg.value`/balances with 18
 * decimals while HBAR itself has 8 (packages/nextjs/scaffold.config.ts has the same note).
 */
export const tinybarToWeibar = (tinybar: bigint): bigint => tinybar * 10_000_000_000n;

export function encodeExactInput(params: ExactInputParams): Hex {
  return encodeFunctionData({ abi: routerAbi, functionName: "exactInput", args: [params] });
}

/**
 * HBAR -> token: `exactInput`'s `amountIn` is also the HBAR value the call must
 * carry (`valueWeibar`, for a wallet's `value` field or a scheduled ContractCall's
 * payable amount). Wrapped in `multicall` with `refundETH`, exactly as
 * docs.saucerswap.finance's "Swap exact HBAR for tokens" example, so unspent WHBAR
 * dust comes back to `params.recipient` instead of staying in the router.
 */
export function buildSwapFromHbarCalldata(params: ExactInputParams): { data: Hex; valueWeibar: bigint } {
  const swap = encodeExactInput(params);
  const refund = encodeFunctionData({ abi: routerAbi, functionName: "refundETH" });
  const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[swap, refund]] });
  return { data, valueWeibar: tinybarToWeibar(params.amountIn) };
}

/**
 * Token -> token (or token -> WHBAR, left wrapped): a plain `exactInput` call, no
 * value to attach. The caller needs to have associated `path`'s first token and,
 * for an HTS token, approved the router for `amountIn` beforehand — this module
 * does not build either of those (association: see `./associate.js`; approval is a
 * standard ERC-20 `approve` call on the token, out of scope here).
 */
export const buildSwapFromTokenCalldata = (params: ExactInputParams): Hex => encodeExactInput(params);

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
 * Turns router calldata back into a plain structure — for a "what you're about to
 * sign" screen, or to assert what an agent proposed. Throws if `data` does not
 * match any function on `routerAbi`. docs/research/spike-swap-2026-09-24.md
 * finding 12 calls this "clear-signing": a dApp must show this, not just rely on
 * the wallet's own receipt (finding 4 — a wallet shows SUCCESS even when the
 * scheduled swap itself reverted).
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
    // viem checksum-cases `address` values it decodes from ABI-encoded data (EIP-55);
    // everything else in this package (the address book, hederaIdToLongZeroAddress,
    // decodePath's own token addresses) is plain lowercase, so normalize to match —
    // otherwise a naive `=== recipient` against an address from elsewhere in this
    // package silently fails on any address containing a-f.
    recipient: params.recipient.toLowerCase() as Address,
    deadline: params.deadline,
    amountIn: params.amountIn,
    amountOutMinimum: params.amountOutMinimum,
    valueWeibar: tinybarToWeibar(params.amountIn),
  };
}
