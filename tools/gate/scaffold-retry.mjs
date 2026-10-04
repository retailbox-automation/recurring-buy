#!/usr/bin/env node
// Runs create-scaffold-hbar for local-gate.sh, and runs it again when the CLI did not read
// this template's template.json.
//
// create-scaffold-hbar 0.4.0 and 0.4.1 read template.json through the GitHub REST API without
// a token and with a 10 s timeout (fetchTemplateManifestFromGithub in dist/cli.js). On any
// answer but 200 they say nothing and use their own defaults, Foundry and Yarn
// (docs/cli-manifest-fallback.md). GitHub allows 60 requests without a token an hour per IP
// address, and a CI runner's address may have used them up. A Hardhat template then stops
// with FoundryValidationError where forge is not installed, or comes out as the Foundry
// variant where it is. Either way the CLI never read the template, so the scaffold runs again,
// up to --attempts times, and waits for the limit to reset when it is used up. Any other
// failure is reported at once, and a fallback on every attempt is a failure too.
//
// Usage: node tools/gate/scaffold-retry.mjs --app <dir> --framework <hardhat|foundry> --log <file>
//          [--attempts N] -- <command...>
//   Runs <command> in the parent directory of <dir> and expects the project in <dir>.
//   --framework is the one the CLI should take from template.json. When the command passes
//   -s, the CLI does not depend on template.json: use --attempts 1.
//   Prints a note for the gate's report on stdout, and progress on stderr.
// Environment: GATE_SCAFFOLD_PAUSE      seconds between attempts (default 20)
//              GATE_SCAFFOLD_MAX_WAIT   seconds all attempts may wait in total (default 1200)
// Exit codes: 0 scaffolded with --framework; 1 failed; 3 the CLI used its defaults on every attempt.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXIT_FALLBACK = 3;
const CLI_DEFAULT_FRAMEWORK = "foundry"; // DEFAULT_OPTIONS.solidityFramework in create-scaffold-hbar

/**
 * What one run of the CLI produced: "ok", "fallback" (the CLI used its own defaults instead of
 * template.json) or "failed" (anything else; not retried).
 */
export function classifyScaffold({ code, output, appDir, framework }) {
  const has = rel => fs.existsSync(path.join(appDir, rel));
  const fallbackPossible = framework !== CLI_DEFAULT_FRAMEWORK;
  if (code === 0 && has("package.json")) {
    if (has(`packages/${framework}`)) return { outcome: "ok" };
    if (fallbackPossible && has(`packages/${CLI_DEFAULT_FRAMEWORK}`)) {
      return { outcome: "fallback", reason: `the scaffold has packages/foundry instead of packages/${framework}` };
    }
    return { outcome: "failed", reason: `the scaffold has no packages/${framework}` };
  }
  if (fallbackPossible && /FoundryValidationError/.test(output)) {
    return { outcome: "fallback", reason: "FoundryValidationError: the CLI chose Foundry and forge is not installed" };
  }
  return { outcome: "failed", reason: code === 0 ? "exit 0 but no package.json" : `exit ${code}` };
}

/**
 * Calls runOnce(n) until an attempt is not a fallback or `attempts` are used; wait(n, result) runs
 * between attempts. Returns the last result with the number of attempts and the earlier fallbacks.
 */
export async function scaffoldWithRetry({ attempts, runOnce, wait }) {
  const fallbacks = [];
  for (let n = 1; ; n++) {
    const result = await runOnce(n);
    if (result.outcome !== "fallback" || n >= attempts) return { ...result, attempts: n, fallbacks };
    fallbacks.push(result.reason);
    await wait(n, result);
  }
}

/** GitHub's REST API limit for requests without a token from this machine; this request does not count. */
export async function githubRateLimit() {
  try {
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const { remaining, limit, reset } = (await res.json()).resources.core;
    return { remaining, limit, reset };
  } catch {
    return null;
  }
}

function describeLimit(limit) {
  if (!limit) return "GitHub's rate limit for requests without a token could not be read";
  const reset = new Date(limit.reset * 1000).toISOString().slice(11, 19);
  return `GitHub API without a token: ${limit.remaining} of ${limit.limit} requests left until ${reset} UTC`;
}

function parseArgs(argv) {
  const split = argv.indexOf("--");
  const options = { attempts: "1" };
  const flags = split === -1 ? argv : argv.slice(0, split);
  for (let i = 0; i < flags.length; i += 2) options[flags[i].replace(/^--/, "")] = flags[i + 1];
  const attempts = Number(options.attempts);
  const command = split === -1 ? [] : argv.slice(split + 1);
  if (!options.app || !options.framework || !options.log || !(attempts >= 1) || command.length === 0) {
    throw new Error("usage: scaffold-retry.mjs --app <dir> --framework <fw> --log <file> [--attempts N] -- <cmd...>");
  }
  return { app: path.resolve(options.app), framework: options.framework, log: options.log, attempts, command };
}

function seconds(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Returns { code, note }: the exit code and the note for the gate's report. */
export async function main(
  argv,
  { probe = githubRateLimit, sleep = ms => new Promise(r => setTimeout(r, ms)), progress = m => console.error(m) } = {},
) {
  const { app, framework, log, attempts, command } = parseArgs(argv);
  const pause = seconds("GATE_SCAFFOLD_PAUSE", 20);
  let waitLeft = seconds("GATE_SCAFFOLD_MAX_WAIT", 1200);
  fs.writeFileSync(log, "");

  const runOnce = n => {
    if (n > 1) {
      fs.rmSync(app, { recursive: true, force: true });
      fs.appendFileSync(log, `\n---- attempt ${n} ----\n`);
    }
    const start = fs.statSync(log).size;
    const fd = fs.openSync(log, "a");
    const run = spawnSync(command[0], command.slice(1), { cwd: path.dirname(app), stdio: ["ignore", fd, fd] });
    fs.closeSync(fd);
    if (run.error) fs.appendFileSync(log, `${run.error.message}\n`);
    const output = fs.readFileSync(log).subarray(start).toString("utf8");
    return classifyScaffold({ code: run.status ?? 1, output, appDir: app, framework });
  };

  const wait = async (n, result) => {
    const limit = await probe();
    let delay = pause;
    if (limit?.remaining === 0) delay = Math.max(delay, limit.reset - Math.floor(Date.now() / 1000) + 5);
    delay = Math.max(0, Math.min(delay, waitLeft));
    waitLeft -= delay;
    progress(
      `scaffold attempt ${n}: the CLI did not read template.json (${result.reason}). ` +
        `${describeLimit(limit)}. Attempt ${n + 1} in ${delay} s.`,
    );
    await sleep(delay * 1000);
  };

  const result = await scaffoldWithRetry({ attempts, runOnce, wait });
  const retried = result.fallbacks.length;
  const earlier = retried
    ? `attempt${retried > 1 ? `s 1-${retried}` : " 1"}: the CLI did not read template.json ` +
      `(${[...new Set(result.fallbacks)].join("; ")})`
    : "";
  if (result.outcome === "ok") {
    return { code: 0, note: earlier && `scaffolded on attempt ${result.attempts}; ${earlier}` };
  }
  if (result.outcome === "failed") {
    return { code: 1, note: [result.reason, earlier].filter(Boolean).join("; ") };
  }
  const note =
    `the CLI did not read template.json on ${result.attempts} attempt${result.attempts > 1 ? "s" : ""} ` +
    `and used its own defaults (${result.reason}); ${describeLimit(await probe())}`;
  return { code: EXIT_FALLBACK, note };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, note } = await main(process.argv.slice(2));
  if (note) console.log(note);
  process.exitCode = code;
}
