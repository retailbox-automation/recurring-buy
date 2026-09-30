import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";

import { associateCalldata, hip719Abi, isAssociatedViaMirror } from "../src/associate.js";

test("associateCalldata decodes back to associate() with no args", () => {
  const data = associateCalldata();
  const decoded = decodeFunctionData({ abi: hip719Abi, data });
  assert.equal(decoded.functionName, "associate");
  assert.equal(decoded.args, undefined); // viem omits `args` entirely for a zero-arg function
});

function stubFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

test("isAssociatedViaMirror is true when the token is in the mirror response", async () => {
  // shape of the real S1 response after association (docs/testnet-findings.md).
  const fixture = { tokens: [{ token_id: "0.0.1183558", balance: 0, automatic_association: false }] };
  const result = await isAssociatedViaMirror(
    "https://testnet.mirrornode.hedera.com/api/v1",
    "0.0.10702176",
    "0.0.1183558",
    stubFetch(200, fixture),
  );
  assert.equal(result, true);
});

test("isAssociatedViaMirror is false on an empty tokens array (the real pre-association S1 fixture)", async () => {
  const result = await isAssociatedViaMirror(
    "https://testnet.mirrornode.hedera.com/api/v1",
    "0.0.10702176",
    "0.0.1183558",
    stubFetch(200, { tokens: [] }),
  );
  assert.equal(result, false);
});

test("isAssociatedViaMirror throws on a non-OK response", async () => {
  await assert.rejects(() => isAssociatedViaMirror("https://x", "0.0.1", "0.0.2", stubFetch(404, {})), /404/);
});
