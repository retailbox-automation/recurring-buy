# countersign — Hedera scaffold-hbar template (work in progress)

`countersign` is a working name. This is a [scaffold-hbar](https://docs.hedera.com/solutions/tools/scaffold-hbar/index) template: a Next.js frontend and Hardhat contracts in one workspace, for Hedera testnet and mainnet.

The use case is not built yet. Today the repository is the official blank starter plus the checks that keep the template scaffoldable: a validated `template.json`, a gate that scaffolds the template from GitHub and builds it, and a Hedera Harness recipe. [PROVENANCE.md](PROVENANCE.md) lists what is starter code and what is ours.

## Create a project from this template

The repository is `retailbox-automation/scaffold-hbar-bounty-wip` while it is being built. It is private, and the public name is not final.

```bash
npx create-scaffold-hbar@latest my-app --template retailbox-automation/scaffold-hbar-bounty-wip
```

With `npm` instead of `npx`, put `--` before the CLI flags:

```bash
npm create scaffold-hbar@latest my-app -- --template retailbox-automation/scaffold-hbar-bounty-wip
```

Without `--`, `npm` keeps `--template` for itself: npm@12 stops with `EUNKNOWNCONFIG Unknown cli flags: --template`, and npm@10 drops the flag, so the CLI falls back to its interactive template prompt, which fails without a terminal.

Add `--package-manager npm` to get an npm-based project. The CLI reads `template.json` from the `main` branch. If it cannot read the file, it quietly offers every framework instead of Hardhat, so `main` stays the default branch.

## Prerequisites

- Node.js 20.18.3 or later
- Git with `user.name` and `user.email` set (the CLI makes the first commit)
- Yarn (`corepack enable` installs it), or npm, for npm-based projects

## Run it

```bash
yarn next:dev                   # frontend on http://localhost:3000; no wallet or .env needed
yarn hardhat:account:generate   # deployer key, stored encrypted in packages/hardhat/.env
yarn hardhat:deploy:testnet     # needs testnet HBAR from https://portal.hedera.com/faucet
```

For a local chain, start `yarn hardhat:chain` and deploy to it from a second terminal: `yarn hardhat:deploy --network localhost`, or in an npm-based project `npm run hardhat:deploy -- --network localhost`.

## Template checks (`tools/gate/`)

The bounty's eligibility gate is mechanical, and its official self-check script is not published yet. These scripts check the same items.

| Command | What it checks |
| --- | --- |
| `yarn gate:test` | the gate tools themselves: each check passes on good input and fails on broken input |
| `yarn gate:manifest` | `template.json` against the zod schema of create-scaffold-hbar 0.4.0, and against the packages in this repository |
| `yarn gate:secrets` | secrets and `.env` files in the working tree and the whole git history |
| `bash tools/gate/local-gate.sh <owner/repo[#ref]> <package-manager> [--strict]` | the full gate on a fresh scaffold from GitHub |

`local-gate.sh` scaffolds the template with `npx create-scaffold-hbar@0.4.0` into a temporary directory, then runs install, lint with zero warnings, type checks, contract compile and `next build` with an empty environment. It starts `next start` without a `.env` and requests every route listed in `.harness/validators/playwright-smoke.yaml`. It also scans the scaffold and the repository history for secrets and checks the MIT licence. It prints a table G1–G8 with the time of each step and exits non-zero on any failure. Until the README carries a testnet transaction link, G6 shows `PENDING`; `--strict` turns that into a failure.

`.github/workflows/gate.yml` runs the same gate on Node 20.18.3, 22 and 24, for Yarn, npm@10 and npm@12. It runs only in a repository that has `template.json`. The CLI deletes that file from the projects it creates, so there the workflow stays idle, and `tools/gate/` and `gate.yml` can be deleted.

## Develop with Hedera Harness

```bash
npx hedera-harness doctor     # checks the setup; no agent, no keys
npx hedera-harness validate   # install, lint, build, test, secret scan, then renders the core routes
yarn harness:run              # agent run; needs a logged-in Claude Code or Cursor CLI
```

The recipe, its pinned version and the steps for npm-based projects are in [.harness/README.md](.harness/README.md).

## Layout

```
packages/hardhat   contracts, deploy scripts, tests (Hardhat, hardhat-deploy)
packages/nextjs    Next.js App Router app, wallet connect, Debug Contracts, block explorer
packages/saucerswap  SaucerSwap V2 client (quotes, swap calldata, HTS association, gas)
tools/gate         eligibility gate scripts and tests
.harness           Hedera Harness recipe and validators
template.json      manifest read by create-scaffold-hbar
```

## License

MIT, see [LICENSE](LICENSE). The starter is Copyright (c) 2023 BuidlGuidl and (c) 2026 hedera-dev; details in [PROVENANCE.md](PROVENANCE.md).
