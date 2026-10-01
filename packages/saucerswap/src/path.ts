import { type Address, type Hex, encodePacked } from "viem";

/**
 * A SaucerSwap V2 path through one pool, packed as in Uniswap V3: `tokenIn` (20 bytes), the pool fee in hundredths of
 * a bip (3 bytes), `tokenOut` (docs.saucerswap.finance/developers/v2/swap). `RecurringBuy` packs the same bytes.
 */
export const encodeSingleHopPath = (tokenIn: Address, fee: number, tokenOut: Address): Hex =>
  encodePacked(["address", "uint24", "address"], [tokenIn, fee, tokenOut]);
