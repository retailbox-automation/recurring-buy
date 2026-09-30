# Template checks

| Command | What it checks |
| --- | --- |
| `yarn hardhat:test` | the contract, on mocks of the Schedule Service, the Token Service, an HTS token and the router |
| `yarn next:test` | the app's plan history, mirror node and cost code, on recorded testnet responses |
| `yarn saucerswap:test` | the SaucerSwap client |
| `yarn lint` | all three packages |
| `yarn gate:test` | the gate tools themselves: each check passes on good input and fails on broken input |
| `yarn gate:manifest` | `template.json` against the schema of create-scaffold-hbar, and against the packages in this repository |
| `yarn gate:secrets` | secrets and `.env` files in the working tree and the whole git history |
| `yarn gate:local` | the full gate on the last local commit, before it is pushed (Yarn leg) |
| `bash tools/gate/local-gate.sh <owner/repo[#ref]> <package-manager> [--strict]` | the full gate on a fresh scaffold from GitHub |

`local-gate.sh` scaffolds the template with create-scaffold-hbar into a temporary directory (with `--local` the CLI copies the last commit instead of downloading it), then runs install, lint with zero warnings, type checks, contract compile and `next build` with an empty environment. It starts the built app without a `.env` and requests every route listed in `.harness/validators/playwright-smoke.yaml`. It also scans the scaffold and the repository history for secrets and checks the MIT licence. Until the README carries a testnet transaction link the testnet item shows `PENDING`; `--strict` turns that into a failure.

`.github/workflows/gate.yml` runs the same gate on Node 20.18.3, 22 and 24, for Yarn, npm@10 and npm@12. It runs only in a repository that has `template.json`. The CLI deletes that file from the projects it creates, so there the workflow stays idle, and `tools/gate/` and `gate.yml` can be deleted.

## Hedera Harness

```bash
npx hedera-harness doctor     # checks the setup; no agent, no keys
npx hedera-harness validate   # install, lint, build, test, secret scan, then renders the core routes
```

The recipe, its pinned version and the steps for npm-based projects are in [.harness/README.md](../.harness/README.md).
