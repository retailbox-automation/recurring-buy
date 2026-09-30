// Tests for the gate tools. Every "passes" case has a "must fail" twin, so a
// validator or scanner that accepts everything cannot go green here.
// Run: node --test tools/gate/gate.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contractCopyProblems } from "./same-contracts.mjs";
import { scanTree, selfTest } from "./scan-secrets.mjs";
import { validateTemplateJson } from "./validate-template-json.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const tmpDirs = [];
after(() => tmpDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const packages = { "packages/hardhat/package.json": "{}", "packages/nextjs/package.json": "{}" };
const manifest = overrides =>
  JSON.stringify({
    name: "t",
    "create-scaffold-hbar": {
      capabilities: { frontend: ["nextjs-app"], solidityFramework: ["hardhat"], packageManager: ["yarn", "npm"] },
      defaults: { frontend: "nextjs-app", solidityFramework: "hardhat", packageManager: "yarn" },
      ...overrides,
    },
  });

function runNode(script, args) {
  return spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: "utf8" });
}

test("the repository's template.json is valid", () => {
  const result = validateTemplateJson(path.join(repoRoot, "template.json"));
  assert.deepEqual(result.messages, []);
  assert.equal(result.ok, true);
});

test("a minimal consistent manifest is valid", () => {
  const dir = tmpRepo({ ...packages, "template.json": manifest({}) });
  assert.equal(validateTemplateJson(path.join(dir, "template.json")).ok, true);
});

const broken = {
  "unknown framework value": manifest({ capabilities: { solidityFramework: ["hardhats"] } }),
  "empty outro step": manifest({ outro: { sections: [{ steps: [{}] }] } }),
  "invalid JSON": "{ name: t }",
  "missing name": JSON.stringify({ "create-scaffold-hbar": {} }),
  "default outside capabilities": manifest({
    defaults: { frontend: "nextjs-app", solidityFramework: "foundry", packageManager: "yarn" },
  }),
  "no capabilities (CLI would offer everything)": JSON.stringify({ name: "t" }),
};

for (const [label, content] of Object.entries(broken)) {
  test(`rejects a manifest with ${label}`, () => {
    const dir = tmpRepo({ ...packages, "template.json": content });
    const result = validateTemplateJson(path.join(dir, "template.json"));
    assert.equal(result.ok, false);
    assert.ok(result.messages.length > 0);
  });
}

test("rejects a framework that has no package", () => {
  const dir = tmpRepo({ "packages/nextjs/package.json": "{}", "template.json": manifest({}) });
  const result = validateTemplateJson(path.join(dir, "template.json"));
  assert.equal(result.ok, false);
  assert.match(result.messages.join("\n"), /packages\/hardhat/);
});

test("validator CLI exit codes: 0 for valid, 1 for invalid, 1 for missing file", () => {
  const good = tmpRepo({ ...packages, "template.json": manifest({}) });
  const bad = tmpRepo({ ...packages, "template.json": broken["unknown framework value"] });
  assert.equal(runNode("validate-template-json.mjs", [path.join(good, "template.json")]).status, 0);
  assert.equal(runNode("validate-template-json.mjs", [path.join(bad, "template.json")]).status, 1);
  assert.equal(runNode("validate-template-json.mjs", [path.join(good, "absent.json")]).status, 1);
});

test("secret scanner self-test passes", () => {
  assert.deepEqual(selfTest(), []);
});

test("secret scanner is quiet on a clean tree", () => {
  const dir = tmpRepo({
    "README.md": "tx 0x" + "e".repeat(64),
    "packages/nextjs/.env.example": "NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=\nHEDERA_RPC_URL=https://testnet.hashio.io/api\n",
  });
  const report = scanTree(dir);
  assert.deepEqual(report.findings, []);
  assert.equal(report.scanned, 2);
});

test("secret scanner reports a committed .env, a key and a filled .env.example", () => {
  const dir = tmpRepo({
    ".env": "X=1\n",
    "src/config.ts": 'const OPERATOR_KEY = "0x' + "f".repeat(64) + '";\n',
    "packages/hardhat/.env.example": "DEPLOYER_PRIVATE_KEY=abc123\n",
  });
  const rules = scanTree(dir).findings.map(f => f.rule).sort();
  assert.deepEqual(rules, ["env-example-value", "env-file", "hex-key-assignment"]);
  assert.equal(runNode("scan-secrets.mjs", ["--tree", dir]).status, 1);
});

test("secret scanner skips a git submodule and still reads the files around it", () => {
  const dir = tmpRepo({ "src/config.ts": 'const OPERATOR_KEY = "0x' + "f".repeat(64) + '";\n' });
  fs.mkdirSync(path.join(dir, "lib/dep"), { recursive: true });
  const git = args => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},lib/dep`]);
  const report = scanTree(dir);
  assert.deepEqual(report.readErrors, []);
  assert.equal(report.skipped, 1);
  assert.deepEqual(report.findings.map(f => f.rule), ["hex-key-assignment"]);
});

const contracts = {
  "packages/hardhat/contracts/A.sol": "contract A {}\n",
  "packages/hardhat/contracts/mocks/M.sol": "contract M {}\n",
  "packages/foundry/contracts/A.sol": "contract A {}\n",
  "packages/foundry/contracts/mocks/M.sol": "contract M {}\n",
};

test("the repository's Hardhat and Foundry contracts are the same", () => {
  assert.deepEqual(contractCopyProblems(repoRoot), []);
});

test("contract copies: identical copies pass, and so does a single package", () => {
  assert.deepEqual(contractCopyProblems(tmpRepo(contracts)), []);
  assert.deepEqual(contractCopyProblems(tmpRepo({ "packages/hardhat/contracts/A.sol": "contract A {}\n" })), []);
});

test("contract copies: a changed byte or a missing file fails", () => {
  const changed = tmpRepo({ ...contracts, "packages/foundry/contracts/mocks/M.sol": "contract M { }\n" });
  assert.deepEqual(contractCopyProblems(changed), [
    "contracts/mocks/M.sol differs between packages/hardhat/contracts and packages/foundry/contracts",
  ]);
  const missing = { ...contracts };
  delete missing["packages/foundry/contracts/A.sol"];
  assert.match(contractCopyProblems(tmpRepo(missing)).join("\n"), /packages\/hardhat\/contracts\/A\.sol has no copy/);
  assert.equal(runNode("same-contracts.mjs", [tmpRepo(missing)]).status, 1);
  assert.equal(runNode("same-contracts.mjs", [tmpRepo(contracts)]).status, 0);
});
