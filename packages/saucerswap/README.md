# @sh/saucerswap

A small SaucerSwap V2 client for Hedera: contract addresses, quotes through `eth_call`, swap calldata (build and decode), HTS token association, wrapping HBAR into WHBAR through SaucerSwap's WhbarHelper, and a gas limit for swaps. No React and no wallet, just `viem`.

The app in this workspace uses the addresses and endpoints, `hederaIdToLongZeroAddress`, `encodeSingleHopPath`, `quoteExactInput` and `minOut` for the quote and the price floor, `associateCalldata` and `buildWrapHbar` for the transactions on `/plans/new`, and `tinybarToWeibar`. The rest (the swap calldata builders and their decoder, `recommendedSwapGasLimit`, `createSaucerSwapClient` and the raw ABIs) is there for a template that swaps from the browser.

## Use

```ts
import {
  TESTNET_ADDRESSES,
  buildSwapFromHbarCalldata,
  createSaucerSwapClient,
  encodeSingleHopPath,
  minOut,
  quoteExactInput,
} from "@sh/saucerswap";

const client = createSaucerSwapClient("testnet");
const path = encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 3000, SAUCE_TOKEN_ADDRESS);
const quote = await quoteExactInput(client, TESTNET_ADDRESSES.quoter, path, 100_000_000n); // 1 HBAR, in tinybar
const { data, valueWeibar } = buildSwapFromHbarCalldata({
  path,
  recipient: humanEvmAddress,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  amountIn: 100_000_000n,
  amountOutMinimum: minOut(quote.amountOut, 100), // 1% below the quote
});
// Send { to: TESTNET_ADDRESSES.router, data, value: valueWeibar } from a wallet or as a scheduled contract call.
```

The Next.js app imports it as `@sh/saucerswap`. Its `dev`, `start`, `build` and `check-types` scripts compile this package first (`tsc -p ../saucerswap/tsconfig.json`).

## What is checked

`yarn saucerswap:test` checks the path encoding both ways, `minOut` in integers, swap calldata built and decoded again (HBAR to a token, and a token to a token), the HIP-719 `associate()` calldata, the gas limit padding, the WhbarHelper `deposit()` transaction, and the address book against `hederaIdToLongZeroAddress`. `yarn saucerswap:test:live` also calls `quoteExactInput` and `eth_gasPrice` on Hedera testnet; it is skipped by default, so the template's checks never depend on testnet being reachable.

Every testnet address and gas figure traces to the repository's [docs/testnet-findings.md](../../docs/testnet-findings.md): the swap figures to run A (S1 is an association, S2 to S5 are schedules), the WhbarHelper to D2 and G1. The mainnet addresses come from SaucerSwap's documentation.

## License

MIT, see the repository's [LICENSE](../../LICENSE).
