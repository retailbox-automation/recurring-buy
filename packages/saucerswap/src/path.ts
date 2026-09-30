import { type Address, type Hex, encodePacked } from "viem";

/**
 * A SaucerSwap V2 path, packed as in Uniswap V3: token (20 bytes), pool fee in hundredths of a bip (3 bytes), token,
 * and so on (docs.saucerswap.finance/developers/v2/swap).
 */
export type SwapPath = { tokens: readonly Address[]; fees: readonly number[] };

/** Packs a swap path. `fees[i]` is the pool fee between `tokens[i]` and `tokens[i + 1]`. */
export function encodePath(tokens: readonly Address[], fees: readonly number[]): Hex {
  if (tokens.length < 2) throw new Error(`encodePath needs at least 2 tokens, got ${tokens.length}`);
  if (fees.length !== tokens.length - 1) {
    throw new Error(`encodePath needs tokens.length - 1 fees, got ${tokens.length} tokens and ${fees.length} fees`);
  }
  const types: ("address" | "uint24")[] = [];
  const values: (Address | number)[] = [];
  tokens.forEach((token, i) => {
    types.push("address");
    values.push(token);
    if (i < fees.length) {
      types.push("uint24");
      values.push(fees[i]);
    }
  });
  return encodePacked(types, values);
}

/** A path through one pool. */
export const encodeSingleHopPath = (tokenIn: Address, fee: number, tokenOut: Address): Hex =>
  encodePath([tokenIn, tokenOut], [fee]);

const HOP_HEX_LENGTH = 46; // a 3-byte fee and a 20-byte address

/** Unpacks a swap path built by `encodePath`. Throws on a malformed length. */
export function decodePath(path: Hex): SwapPath {
  const hex = path.slice(2);
  if (hex.length < 40 || (hex.length - 40) % HOP_HEX_LENGTH !== 0) {
    throw new Error(`malformed SaucerSwap V2 path (${hex.length / 2} bytes): ${path}`);
  }
  const tokens: Address[] = [`0x${hex.slice(0, 40)}` as Address];
  const fees: number[] = [];
  for (let offset = 40; offset < hex.length; offset += HOP_HEX_LENGTH) {
    fees.push(parseInt(hex.slice(offset, offset + 6), 16));
    tokens.push(`0x${hex.slice(offset + 6, offset + 6 + 40)}` as Address);
  }
  return { tokens, fees };
}
