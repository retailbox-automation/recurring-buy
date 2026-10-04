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
import { EXIT_FALLBACK, classifyScaffold, main as scaffoldMain, scaffoldWithRetry } from "./scaffold-retry.mjs";
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

// ---- scaffold-retry: a scaffold where the CLI used its defaults instead of template.json runs again;
// any other failure does not, and a fallback on every attempt fails.

const project = packageDirs =>
  tmpRepo({
    "package.json": "{}",
    ...Object.fromEntries(packageDirs.map(dir => [`packages/${dir}/package.json`, "{}"])),
  });
const foundryError = "ERROR Error occurred FoundryValidationError:\n    Could not parse foundry version.";

test("scaffold: a project with the manifest's framework is ok", () => {
  const appDir = project(["hardhat", "nextjs"]);
  assert.equal(classifyScaffold({ code: 0, output: "", appDir, framework: "hardhat" }).outcome, "ok");
});

test("scaffold: the CLI's own defaults are a fallback; every other failure is not", () => {
  const none = path.join(tmpRepo({}), "app");
  const cases = [
    // [what happened, exit code, output, project directory, framework, outcome]
    ["FoundryValidationError without -s", 1, foundryError, none, "hardhat", "fallback"],
    ["Foundry project instead of Hardhat", 0, "", project(["foundry"]), "hardhat", "fallback"],
    ["FoundryValidationError with -s foundry", 1, foundryError, none, "foundry", "failed"],
    ["another CLI error", 1, "Error: template not found", none, "hardhat", "failed"],
    ["no package for the framework", 0, "", project(["nextjs"]), "hardhat", "failed"],
    ["exit 0 and no project", 0, "", none, "hardhat", "failed"],
  ];
  for (const [label, code, output, appDir, framework, outcome] of cases) {
    assert.equal(classifyScaffold({ code, output, appDir, framework }).outcome, outcome, label);
  }
});

async function retry(outcomes) {
  const waits = [];
  const result = await scaffoldWithRetry({
    attempts: 3,
    runOnce: n => ({ outcome: outcomes[n - 1], reason: `attempt ${n}` }),
    wait: n => waits.push(n),
  });
  return [result.outcome, result.attempts, waits];
}

test("scaffold retry: fallbacks are retried until an attempt is ok", async () => {
  assert.deepEqual(await retry(["fallback", "fallback", "ok"]), ["ok", 3, [1, 2]]);
});

test("scaffold retry: a fallback on every attempt fails after the last one", async () => {
  assert.deepEqual(await retry(["fallback", "fallback", "fallback"]), ["fallback", 3, [1, 2]]);
});

test("scaffold retry: a real failure is reported at once, not retried", async () => {
  assert.deepEqual(await retry(["failed", "ok"]), ["failed", 1, []]);
});

// A stand-in for create-scaffold-hbar: plays one scripted outcome per run, in the order given.
const fakeCli = `const fs = require("fs");
const [plan, counter] = process.argv.slice(2);
const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;
fs.writeFileSync(counter, String(n));
const step = JSON.parse(fs.readFileSync(plan, "utf8"))[n - 1];
if (step === "ok") {
  fs.mkdirSync("app/packages/hardhat", { recursive: true });
  fs.writeFileSync("app/package.json", "{}");
} else {
  console.log(step === "fallback" ? ${JSON.stringify(foundryError)} : "Error: the template is broken");
  process.exit(1);
}
`;

function fakeScaffold(plan, attempts) {
  const dir = tmpRepo({ "fake-cli.cjs": fakeCli, "plan.json": JSON.stringify(plan) });
  const runs = path.join(dir, "runs");
  const log = path.join(dir, "scaffold.log");
  const args = ["--app", path.join(dir, "app"), "--framework", "hardhat", "--log", log, "--attempts", String(attempts)];
  const command = [process.execPath, path.join(dir, "fake-cli.cjs"), path.join(dir, "plan.json"), runs];
  return { args: [...args, "--", ...command], log, runCount: () => Number(fs.readFileSync(runs, "utf8")) };
}

test("scaffold-retry: waits for GitHub's limit to reset, then passes on the next attempt", async () => {
  const run = fakeScaffold(["fallback", "ok"], 3);
  const sleeps = [];
  const messages = [];
  const reset = Math.floor(Date.now() / 1000) + 30;
  const { code, note } = await scaffoldMain(run.args, {
    probe: async () => ({ remaining: 0, limit: 60, reset }),
    sleep: async ms => sleeps.push(ms),
    progress: message => messages.push(message),
  });
  assert.equal(code, 0);
  assert.equal(run.runCount(), 2);
  assert.match(note, /^scaffolded on attempt 2; attempt 1: the CLI did not read template.json \(FoundryValidation/);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 30_000 && sleeps[0] <= 36_000, `waited ${sleeps[0]} ms`);
  assert.match(messages[0], /0 of 60 requests left/);
  assert.match(fs.readFileSync(run.log, "utf8"), /FoundryValidationError[\s\S]*---- attempt 2 ----/);
});

test("scaffold-retry: a fallback on all 3 attempts exits 3 with the reason", async () => {
  const run = fakeScaffold(["fallback", "fallback", "fallback"], 3);
  const sleeps = [];
  const { code, note } = await scaffoldMain(run.args, {
    probe: async () => ({ remaining: 0, limit: 60, reset: Math.floor(Date.now() / 1000) + 600 }),
    sleep: async ms => sleeps.push(ms),
    progress: () => {},
  });
  assert.equal(code, EXIT_FALLBACK);
  assert.equal(run.runCount(), 3);
  assert.equal(sleeps.length, 2);
  assert.match(note, /did not read template.json on 3 attempts and used its own defaults/);
  assert.match(note, /0 of 60 requests left until/);
});

test("scaffold-retry CLI: exit 0 for a good scaffold, exit 1 without a retry for a broken one", () => {
  const good = fakeScaffold(["ok"], 3);
  const ok = runNode("scaffold-retry.mjs", good.args);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "");
  const broken = fakeScaffold(["broken", "ok"], 3);
  const failed = runNode("scaffold-retry.mjs", broken.args);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout.trim(), "exit 1");
  assert.equal(broken.runCount(), 1);
  assert.match(fs.readFileSync(broken.log, "utf8"), /the template is broken/);
});
