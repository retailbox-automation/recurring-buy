#!/usr/bin/env node
// The Hardhat and Foundry packages each carry their own copy of contracts/, because create-scaffold-hbar
// deletes the package of the framework a user did not choose. This checks that the two copies are the
// same, file for file and byte for byte, so both variants ship the same contract.
//
// Usage: node tools/gate/same-contracts.mjs [repository root, default .]
// Exit codes: 0 same (or only one of the packages exists), 1 different.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const COPIES = ["packages/hardhat/contracts", "packages/foundry/contracts"];

function listFiles(dir, rel = "") {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(entry => {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(dir, child) : [child];
  });
}

/** Differences between the two copies under `root`, as sentences; empty when they match. */
export function contractCopyProblems(root) {
  const [a, b] = COPIES.map(copy => path.join(root, copy));
  if (!fs.existsSync(a) || !fs.existsSync(b)) return [];
  const inA = new Set(listFiles(a));
  const inB = new Set(listFiles(b));
  const problems = [];
  for (const file of [...new Set([...inA, ...inB])].sort()) {
    if (!inB.has(file)) problems.push(`${COPIES[0]}/${file} has no copy in ${COPIES[1]}`);
    else if (!inA.has(file)) problems.push(`${COPIES[1]}/${file} has no copy in ${COPIES[0]}`);
    else if (!fs.readFileSync(path.join(a, file)).equals(fs.readFileSync(path.join(b, file)))) {
      problems.push(`contracts/${file} differs between ${COPIES[0]} and ${COPIES[1]}`);
    }
  }
  return problems;
}

function main(root = ".") {
  const problems = contractCopyProblems(root);
  if (problems.length === 0) {
    console.log(`PASS ${COPIES.join(" and ")} are the same`);
    return 0;
  }
  console.error(`FAIL ${COPIES.join(" and ")} differ:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2]);
}
