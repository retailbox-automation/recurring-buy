#!/usr/bin/env node
// Secret scan for the eligibility gate: "No committed secrets and no committed .env".
//
// Scans a working tree and, optionally, the full history of a git repository.
// No dependencies, so it runs before `install`. It is a floor, not a replacement
// for gitleaks: tools/gate/local-gate.sh also runs gitleaks when it is installed.
//
// Before scanning, a self-test proves every rule fires on a synthetic secret and
// stays quiet on a look-alike (a bare transaction hash). A blind scanner fails
// loudly instead of reporting "clean".
//
// Usage: node tools/gate/scan-secrets.mjs --tree <dir> [--history <git-dir>]
// Exit codes: 0 clean, 1 findings, 2 scanner could not vouch for the result.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RULES = [
  { id: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "hedera-der-ed25519-key", re: /302e020100300506032b657004220420[0-9a-fA-F]{64}/ },
  { id: "hedera-der-ecdsa-key", re: /3030020100300706052b8104000a04220420[0-9a-fA-F]{64}/ },
  { id: "hex-key-assignment", re: /(?:key|secret)["']?\s*[:=]\s*["'`]?(?:0x)?[0-9a-fA-F]{64}\b/i },
  { id: "mnemonic-assignment", re: /(?:mnemonic|seed_?phrase)["']?\s*[:=]\s*["'`]?(?:[a-z]+ ){11,23}[a-z]+/i },
  { id: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/ },
  { id: "llm-api-key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    id: "slack-token",
    re: /\bxox[abprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+/,
  },
];

// Synthetic samples, assembled at runtime so this file never contains a match itself.
const hex = char => char.repeat(64);
const SELF_TEST_POSITIVES = {
  "private-key-block": "-----BEGIN " + "PRIVATE KEY-----",
  "hedera-der-ed25519-key": "302e020100300506032b657004220420" + hex("a"),
  "hedera-der-ecdsa-key": "3030020100300706052b8104000a04220420" + hex("b"),
  "hex-key-assignment": "HEDERA_OPERATOR_" + "KEY=0x" + hex("c"),
  "mnemonic-assignment": "MNEMONIC" + '="' + Array(12).fill("abandon").join(" ") + '"',
  "github-token": "gh" + "p_" + "A".repeat(36),
  "llm-api-key": "sk-" + "ant-" + "x".repeat(40),
  "aws-access-key": "AK" + "IA" + "Z".repeat(16),
  "google-api-key": "AI" + "za" + "Q".repeat(35),
  "slack-token": "xo" + "xb-" + "1234567890abc",
};
const SELF_TEST_NEGATIVE = "transactionHash: 0x" + hex("d");

// Vendored or generated files: binaries of the package manager and lockfiles
// (integrity hashes). Everything else is scanned.
const SKIP_PATTERNS = [/^\.yarn\/(releases|plugins)\//, /(^|\/)yarn\.lock$/, /(^|\/)package-lock\.json$/];
const HISTORY_EXCLUDES = [
  ":(exclude,glob)**/.yarn/releases/**",
  ":(exclude,glob)**/.yarn/plugins/**",
  ":(exclude,glob)**/yarn.lock",
  ":(exclude,glob)**/package-lock.json",
];
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_EXAMPLE = /(^|\/)\.env\.example$/;
const SENSITIVE_ENV_KEY = /(KEY|SECRET|TOKEN|PASSWORD|MNEMONIC|PRIVATE)/i;

export function findSecrets(text) {
  const hits = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      const match = line.match(rule.re);
      if (match) hits.push({ rule: rule.id, line: index + 1, excerpt: `${match[0].slice(0, 8)}…` });
    }
  });
  return hits;
}

export function selfTest() {
  const problems = [];
  for (const rule of RULES) {
    const sample = SELF_TEST_POSITIVES[rule.id];
    if (!sample || !rule.re.test(sample)) problems.push(`rule ${rule.id} does not fire on its synthetic sample`);
  }
  if (findSecrets(SELF_TEST_NEGATIVE).length > 0) problems.push("a bare transaction hash is reported as a secret");
  return problems;
}

/** Values of sensitive-looking keys in .env.example must be empty. */
export function envExampleProblems(text) {
  return text
    .split("\n")
    .map((line, index) => ({ line: index + 1, match: line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/) }))
    .filter(({ match }) => match && SENSITIVE_ENV_KEY.test(match[1]) && match[2].trim() !== "")
    .map(({ line, match }) => ({ rule: "env-example-value", line, excerpt: `${match[1]}=…` }));
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
}

function listTreeFiles(dir) {
  const isRepo = fs.existsSync(path.join(dir, ".git"));
  if (isRepo) {
    return git(dir, ["ls-files", "-co", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  }
  const files = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk("");
  return files;
}

export function scanTree(dir) {
  const report = { scanned: 0, skipped: 0, readErrors: [], findings: [] };
  for (const rel of listTreeFiles(dir)) {
    if (ENV_FILE.test(rel) && !ENV_EXAMPLE.test(rel)) {
      report.findings.push({ rule: "env-file", file: rel, line: 0, excerpt: "committed .env file" });
    }
    if (SKIP_PATTERNS.some(re => re.test(rel))) {
      report.skipped++;
      continue;
    }
    let buffer;
    try {
      if (fs.lstatSync(path.join(dir, rel)).isSymbolicLink()) {
        report.skipped++; // the link target is a tracked file and is scanned on its own
        continue;
      }
      buffer = fs.readFileSync(path.join(dir, rel));
    } catch (error) {
      if (error.code === "ENOENT") continue; // deleted in the working tree, still listed by git
      report.readErrors.push(`${rel}: ${error.message}`);
      continue;
    }
    if (buffer.includes(0)) {
      report.skipped++;
      continue;
    }
    report.scanned++;
    const text = buffer.toString("utf8");
    const hits = [...findSecrets(text), ...(ENV_EXAMPLE.test(rel) ? envExampleProblems(text) : [])];
    for (const hit of hits) report.findings.push({ file: rel, ...hit });
  }
  return report;
}

export function scanHistory(gitDir) {
  const report = { commits: 0, addedLines: 0, envFilesEverAdded: [], findings: [] };
  report.commits = Number(git(gitDir, ["rev-list", "--all", "--count"]).trim());
  const patch = git(gitDir, ["log", "--all", "-p", "--no-color", "--no-ext-diff", "--format=%x00%H", "--", ".", ...HISTORY_EXCLUDES]);
  let commit = "";
  let file = "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("\0")) {
      commit = line.slice(1, 13);
    } else if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
    } else if (line.startsWith("+")) {
      report.addedLines++;
      for (const hit of findSecrets(line.slice(1))) {
        report.findings.push({ ...hit, file: `${commit}:${file}`, line: 0 });
      }
    }
  }
  const added = git(gitDir, ["log", "--all", "--diff-filter=A", "--name-only", "--format="]).split("\n");
  report.envFilesEverAdded = [...new Set(added.filter(p => ENV_FILE.test(p) && !ENV_EXAMPLE.test(p)))];
  for (const envFile of report.envFilesEverAdded) {
    report.findings.push({ rule: "env-file-in-history", file: envFile, line: 0, excerpt: "added in a past commit" });
  }
  return report;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--tree", "--history"].includes(argv[i]) || !argv[i + 1]) {
      throw new Error("usage: scan-secrets.mjs --tree <dir> [--history <git-dir>]");
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.tree) throw new Error("usage: scan-secrets.mjs --tree <dir> [--history <git-dir>]");
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const blind = selfTest();
  if (blind.length > 0) {
    console.error("scanner self-test failed, refusing to report a result:");
    for (const problem of blind) console.error(`  - ${problem}`);
    return 2;
  }
  const tree = scanTree(args.tree);
  const findings = [...tree.findings];
  let summary = `tree: ${tree.scanned} files scanned, ${tree.skipped} skipped (vendored/binary/symlink), ${tree.readErrors.length} read errors`;
  if (args.history) {
    const history = scanHistory(args.history);
    findings.push(...history.findings);
    summary += `; history: ${history.commits} commits, ${history.addedLines} added lines, ${history.envFilesEverAdded.length} .env files ever added`;
  }
  console.log(`secret scan (${RULES.length} rules, self-test passed) — ${summary}; findings: ${findings.length}`);
  for (const f of findings) console.log(`  FINDING ${f.rule} ${f.file}${f.line ? `:${f.line}` : ""} ${f.excerpt}`);
  for (const e of tree.readErrors) console.error(`  READ ERROR ${e}`);
  if (tree.readErrors.length > 0) return 2;
  return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
