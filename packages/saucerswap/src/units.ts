/** The relay counts HBAR in weibar (18 decimals), HBAR itself has 8: 1 tinybar is 10^10 weibar. */
export const tinybarToWeibar = (tinybar: bigint): bigint => tinybar * 10_000_000_000n;
