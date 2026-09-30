import assert from "node:assert/strict";
import { test } from "node:test";

import { TESTNET_ADDRESSES } from "../src/addresses.js";
import { createSaucerSwapClient } from "../src/client.js";
import { encodeSingleHopPath } from "../src/path.js";
import { minOut, quoteExactInput } from "../src/quote.js";

const LIVE = process.env.SAUCERSWAP_LIVE === "1";
const SAUCE = "0x0000000000000000000000000000000000120f46" as const; // testnet SAUCE token 0.0.1183558

// The only test in this package that touches the network. Skipped by default so
// `yarn saucerswap:test` (and the eligibility gate) never depends on testnet
// being reachable; run with `yarn saucerswap:test:live` (SAUCERSWAP_LIVE=1).
test(
  "live: quoteExactInput and eth_gasPrice against the Hedera testnet RPC",
  { skip: !LIVE && "set SAUCERSWAP_LIVE=1 to run against the live testnet RPC" },
  async () => {
    const client = createSaucerSwapClient("testnet");

    // WHBAR/SAUCE only has a live pool at the 3000 (0.3%) fee tier
    // (docs/testnet-findings.md: fee 500/1500/10000 all returned no pool).
    const path = encodeSingleHopPath(TESTNET_ADDRESSES.whbar, 3000, SAUCE);
    const quote = await quoteExactInput(client, TESTNET_ADDRESSES.quoter, path, 100_000_000n); // 1 HBAR
    assert.ok(quote.amountOut > 0n, `expected a positive quote, got ${quote.amountOut}`);
    assert.ok(quote.quoterGasEstimate > 0n, `expected a positive gas estimate, got ${quote.quoterGasEstimate}`);
    assert.ok(minOut(quote.amountOut, 100) < quote.amountOut);

    const gasPrice = await client.getGasPrice();
    assert.ok(gasPrice > 0n, `expected a positive eth_gasPrice, got ${gasPrice}`);
  },
);
