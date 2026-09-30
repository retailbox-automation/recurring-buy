# @sh/saucerswap

A small SaucerSwap V2 client for Hedera: contract addresses, gas-free quotes, swap
calldata (build and decode), HTS token association, wrapping HBAR into WHBAR
through SaucerSwap's WhbarHelper, and a gas limit for swaps. No React and no
wallet, just `viem`.

## Use

```ts
import {
  TESTNET_ADDRESSES, createSaucerSwapClient, encodeSingleHopPath,
  quoteExactInput, minOut, buildSwapFromHbarCalldata,
} from "@sh/saucerswap";

const client = createSaucerSwapClient("testnet");
const path = encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 3000, SAUCE_TOKEN_ADDRESS);
const quote = await quoteExactInput(client, TESTNET_ADDRESSES.quoter, path, 100_000_000n); // 1 HBAR, in tinybar
const { data, valueWeibar } = buildSwapFromHbarCalldata({
  path, recipient: humanEvmAddress, deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  amountIn: 100_000_000n, amountOutMinimum: minOut(quote.amountOut, 100), // 1% slippage
});
// send { to: TESTNET_ADDRESSES.router, data, value: valueWeibar } however your app
// signs transactions — a wallet, or a Hedera scheduled ContractCall.
```

From the Next.js app in this workspace: `import { ... } from "@sh/saucerswap"` after
`yarn saucerswap:build` (or add `"@sh/saucerswap"` to `next.config.ts`'s
`transpilePackages` to import the TypeScript source directly, no build step needed).

## What's checked

`yarn saucerswap:test` — path encode/decode roundtrip, integer `minOut`, swap
calldata build+decode roundtrip (HBAR->token and token->token), HIP-719
`associate()` roundtrip, gas-limit padding, the WhbarHelper `deposit()`
transaction, and the address book against `hederaIdToLongZeroAddress`. `yarn
saucerswap:test:live` additionally calls `quoteExactInput` and `eth_gasPrice`
against the live Hedera testnet RPC (skipped by default, so the eligibility gate
never depends on testnet being reachable).

Every constant and gas figure traces to a live testnet run, recorded in the
repository's [docs/testnet-findings.md](../../docs/testnet-findings.md) (run A:
five scheduled swaps, S1-S5).

## License

MIT — see the repository [LICENSE](../../LICENSE).
