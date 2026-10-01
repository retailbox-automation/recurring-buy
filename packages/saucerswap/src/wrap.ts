import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import type { SaucerSwapAddresses } from "./addresses.js";
import { tinybarToWeibar } from "./units.js";

/**
 * SaucerSwap's WhbarHelper: `deposit()` gives the sender as much WHBAR as the HBAR sent with it. SaucerSwap's docs ask
 * integrations to wrap through it, not through the WHBAR contract (docs.saucerswap.finance/developers/whbar/overview).
 */
export const whbarHelperAbi = parseAbi(["function deposit() payable"]);

/**
 * The transaction that wraps `amountTinybar` of HBAR into WHBAR for its sender. The sender must be associated with the
 * WHBAR token first, or have a free automatic association: otherwise it reverts with TOKEN_NOT_ASSOCIATED_TO_ACCOUNT.
 */
export function buildWrapHbar(
  addresses: Pick<SaucerSwapAddresses, "whbarHelper">,
  amountTinybar: bigint,
): { to: Address; data: Hex; value: bigint } {
  if (amountTinybar <= 0n) throw new Error(`the amount to wrap must be above zero, got ${amountTinybar}`);
  return {
    to: addresses.whbarHelper,
    data: encodeFunctionData({ abi: whbarHelperAbi, functionName: "deposit" }),
    value: tinybarToWeibar(amountTinybar),
  };
}
