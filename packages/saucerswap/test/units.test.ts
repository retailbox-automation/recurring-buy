import assert from "node:assert/strict";
import { test } from "node:test";

import { tinybarToWeibar } from "../src/units.js";

test("tinybarToWeibar matches the 1e10 factor the relay uses", () => {
  assert.equal(tinybarToWeibar(100_000_000n), 1_000_000_000_000_000_000n); // 1 HBAR -> 1e18 weibar
});
