import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";

import { associateCalldata, hip719Abi } from "../src/associate.js";

test("associateCalldata decodes back to associate() with no args", () => {
  const data = associateCalldata();
  const decoded = decodeFunctionData({ abi: hip719Abi, data });
  assert.equal(decoded.functionName, "associate");
  assert.equal(decoded.args, undefined); // viem omits `args` entirely for a zero-arg function
});
