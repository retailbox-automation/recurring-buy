# @sh/saucerswap

The SaucerSwap V2 code the app on `/plans/new` uses, with no React and no wallet, just `viem`:

- `ADDRESSES` (`TESTNET_ADDRESSES`, `MAINNET_ADDRESSES`) and `ENDPOINTS`: WHBAR, the SwapRouter, QuoterV2 and WhbarHelper on each network, the chain id, the hashio relay and the mirror node.
- `hederaIdToLongZeroAddress`: the EVM address of a Hedera id such as `0.0.15058`.
- `encodeSingleHopPath`, `quoteExactInput` and `minOut`: the quote for one buy and the price floor below it. `quoteExactInput` rejects when the path has no pool or the pool cannot take the whole amount.
- `associateCalldata`: HIP-719 `associate()`, sent to a token's address.
- `buildWrapHbar`: the transaction that wraps HBAR into WHBAR through SaucerSwap's WhbarHelper.
- `tinybarToWeibar`: HBAR amounts for a transaction's `value`.

## Use

```ts
import { TESTNET_ADDRESSES, encodeSingleHopPath, minOut, quoteExactInput } from "@sh/saucerswap";

// publicClient: any viem client on Hedera testnet, such as wagmi's usePublicClient().
const path = encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 3000, SAUCE_TOKEN_ADDRESS);
const quote = await quoteExactInput(publicClient, TESTNET_ADDRESSES.quoter, path, 100_000_000n); // 1 HBAR, in tinybar
const floor = minOut(quote.amountOut, 100); // 1% below the quote
```

The Next.js app imports it as `@sh/saucerswap`. Its `dev`, `start`, `build` and `check-types` scripts compile this package first (`tsc -p ../saucerswap/tsconfig.json`).

## What is checked

`yarn saucerswap:test` checks the path encoding, how a quote is read from QuoterV2's answer and refused when the pool ran out of liquidity, `minOut` in integers, the HIP-719 `associate()` calldata, the WhbarHelper `deposit()` transaction, the tinybar to weibar factor, and the address book against `hederaIdToLongZeroAddress`. `yarn saucerswap:test:live` also asks the testnet QuoterV2 for a quote of 1 HBAR and for one far beyond the pool's liquidity; it is skipped by default, so the package's checks never depend on testnet being reachable.

The testnet addresses and the gas figures in comments trace to the repository's [docs/testnet-findings.md](../../docs/testnet-findings.md). The mainnet addresses come from SaucerSwap's documentation.

## License

MIT, see the repository's [LICENSE](../../LICENSE).
