# countersign — Hedera scaffold-hbar template (work in progress)

`countersign` is a working name. This is a [scaffold-hbar](https://docs.hedera.com/solutions/tools/scaffold-hbar/index) template: a Next.js frontend and Hardhat contracts in one workspace, for Hedera testnet and mainnet.

The use case is not built yet. Today the repository is the official blank starter plus the checks that keep the template scaffoldable: a validated `template.json`, a gate that scaffolds the template from GitHub and builds it, and a Hedera Harness recipe. What is starter code and what is ours is listed in [PROVENANCE.md](PROVENANCE.md).

## Create a project from this template

The repository is `retailbox-automation/scaffold-hbar-bounty-wip` while it is being built. It is private, and the public name is not final.

```bash
npx create-scaffold-hbar@latest my-app --template retailbox-automation/scaffold-hbar-bounty-wip
```

The same through `npm create`, with `--` before the CLI flags:

```bash
npm create scaffold-hbar@latest my-app -- --template retailbox-automation/scaffold-hbar-bounty-wip
```

Without `--`, npm treats `--template` as its own option. npm@12 stops with `EUNKNOWNCONFIG Unknown cli flags: --template`. npm@10 drops the flag, and the CLI falls back to its interactive template prompt, which fails when there is no terminal.

Add `--package-manager npm` to get an npm project instead of Yarn. The CLI reads `template.json` from the `main` branch; if it cannot read the file, it silently offers every framework, so keep `main` as the default branch.

## Prerequisites

- Node.js 20.18.3 or later
- Git with `user.name` and `user.email` set (the CLI makes the first commit)
- Yarn (default; `corepack enable` provides it) or npm

## Run it

```bash
yarn next:dev                               # frontend on http://localhost:3000, no wallet or .env needed
yarn hardhat:account:generate               # deployer key, stored encrypted in packages/hardhat/.env
yarn hardhat:deploy --network hederaTestnet # needs testnet HBAR: https://portal.hedera.com/faucet
```

For a local chain: `yarn hardhat:chain` in one terminal, `yarn hardhat:deploy --network localhost` in another.

## Template checks (`tools/gate/`)

The bounty's eligibility gate is mechanical, and its official self-check script is not published yet. These scripts check the same items.

| Command | What it checks |
| --- | --- |
| `yarn gate:test` | the gate tools themselves: each check passes on good input and fails on broken input |
| `yarn gate:manifest` | `template.json` against the zod schema of create-scaffold-hbar 0.4.0, and against the packages in this repository |
| `yarn gate:secrets` | secrets and `.env` files in the working tree and the whole git history |
| `yarn gate:local <owner/repo[#ref]> [yarn\|npm] [--strict]` | the full gate on a fresh scaffold from GitHub |

`gate:local` scaffolds the template with `npx create-scaffold-hbar@0.4.0` into a temporary directory, then runs install, lint with zero warnings, type checks, contract compile and `next build` with an empty environment. It starts `next start` without a `.env` and requests every route listed in `.harness/validators/playwright-smoke.yaml`. It also scans the scaffold and the repository history for secrets and checks the MIT licence. It prints a table G1–G8 with the time of each step and exits non-zero on any failure. Until the README carries a testnet transaction link, G6 shows `PENDING`; `--strict` turns that into a failure.

`.github/workflows/gate.yml` runs the same gate on Node 20.18.3, 22 and 24, with Yarn and with npm@10 and npm@12. It runs only in a repository that has `template.json`; the CLI deletes that file from projects it creates, so the workflow stays idle there. In a project created from this template, `tools/gate/` and `gate.yml` can be deleted.

## Develop with Hedera Harness

[Hedera Harness](https://github.com/hedera-dev/hedera-harness) is pinned to `2.0.0-rc.4` (recipe schema v3) in `devDependencies`. The recipe lives in `.harness/`.

```bash
npx hedera-harness doctor     # checks the setup; no agent, no keys
npx hedera-harness validate   # install, lint, build, test, secret scan, then boots the app and renders the core routes
yarn harness:run              # agent run; needs a logged-in Claude Code or Cursor CLI
```

The recipe runs Yarn commands. The CLI copies `.harness/` unchanged into npm projects, so in an npm project point `validators.commands` in `.harness/spec.yaml` at `.harness/validators/npm.json` and change the baseline commands to npm. Feature increments (`prd:`) are not written yet, so `doctor` reports the missing PRD and `harness:run` has nothing to build.

## Layout

```
packages/hardhat   contracts, deploy scripts, tests (Hardhat, hardhat-deploy)
packages/nextjs    Next.js App Router app, wallet connect, Debug Contracts, block explorer
tools/gate         eligibility gate scripts and tests
.harness           Hedera Harness recipe and validators
template.json      manifest read by create-scaffold-hbar
```

## License

MIT, see [LICENSE](LICENSE). The starter is Copyright (c) 2023 BuidlGuidl and (c) 2026 hedera-dev; details in [PROVENANCE.md](PROVENANCE.md).
