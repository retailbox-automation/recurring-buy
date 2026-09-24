# Agent instructions

Briefing for coding agents (Claude Code, Cursor, Codex) working in this repository or in a project created from it. Claude Code loads it through `CLAUDE.md`.

## What this is

A scaffold-hbar template for Hedera: `packages/nextjs` (Next.js App Router, RainbowKit, wagmi, viem, DaisyUI) and `packages/hardhat` (Hardhat, hardhat-deploy). It is Hardhat-only; there is no Foundry package. The use case is not implemented yet: the contracts are the starter samples `HederaToken` (ERC-20) and `HtsTokenCreator` (HTS precompile at `0x167`).

## Package manager

Use the one the project was created with (`packageManager` in the root `package.json`, or the lockfile). Examples use Yarn. In an npm-based project scripts run as `npm run <script>`, and extra arguments need `--` first: `npm run hardhat:deploy -- --network localhost`.

## Commands

```bash
yarn next:dev                    # frontend, http://localhost:3000
yarn hardhat:chain               # local Hedera-forked node on 8545
yarn hardhat:account:generate    # encrypted deployer key in packages/hardhat/.env
yarn hardhat:deploy:testnet      # deploy to Hedera testnet

yarn lint                        # both packages; the gate adds --max-warnings=0
yarn next:check-types
yarn hardhat:compile
yarn next:build
yarn hardhat:test
```

To deploy to the local node, pass `--network localhost` to `hardhat:deploy` (with `--` first in an npm-based project). Without `--network` it targets the in-process `hardhat` network, not the node started by `hardhat:chain`. Mainnet is `hederaMainnet`.

## Where things live

- Contracts `packages/hardhat/contracts/`, deploy scripts `packages/hardhat/deploy/`, tests `packages/hardhat/test/`, networks `packages/hardhat/hardhat.config.ts` (`hederaTestnet` 296, `hederaMainnet` 295).
- After a deploy, ABIs and addresses are written to `packages/nextjs/contracts/deployedContracts.ts`. Third-party contracts go in `packages/nextjs/contracts/externalContracts.ts`.
- Frontend network settings: `packages/nextjs/scaffold.config.ts`.
- Contract hooks: `packages/nextjs/hooks/scaffold-hbar` — `useScaffoldReadContract`, `useScaffoldWriteContract`, `useScaffoldEventHistory`, `useScaffoldWatchContractEvent`, `useDeployedContractInfo`, `useTransactor`. Web3 UI components come from `@scaffold-hbar-ui/components`.
- Next.js imports use the `~~` alias; pages that use hooks need `"use client"`.

## Rules for changes

- Never commit a private key, token or `.env` file. Only `.env.example` files are tracked, and values of key-like variables in them stay empty.
- The app must build and boot with no `.env`: `tools/gate/local-gate.sh` runs `next build` and `next start` in an empty environment and requests every core route, as the bounty's mechanical gate is expected to. Fetch live network data on the client and show an error state when a node or API is unreachable; do not fetch at build time.
- Core routes are listed in `.harness/validators/playwright-smoke.yaml`. Add a route there when you add a page that matters.
- Keep `template.json` in step with `packages/`: its capabilities must name only packages that exist. Run `yarn gate:manifest` after editing it.
- Lint allows zero warnings. Prefer `type` over `interface`; comments should add information.
- Write docs for both package managers. In npm-based projects create-scaffold-hbar rewrites every `yarn`/`Yarn` in text files (except under `.harness/`) to `npm`, then turns any `npm <word>` into `npm run <word>`, prose included. So follow a package-manager name with punctuation or a backtick, not a word; do not append flags to a `yarn <script>` example (`npm` needs `--` before flags), and give the command its own script in `package.json` instead, as `hardhat:deploy:testnet` does.

## Checking your work

```bash
yarn gate:test                                   # gate tools: every check has a must-fail twin
yarn gate:manifest                               # template.json vs the create-scaffold-hbar 0.4.0 schema
yarn gate:secrets                                # secrets and .env in the tree and git history
bash tools/gate/local-gate.sh <owner/repo[#branch]> <package-manager>   # full gate on a fresh scaffold (about 2 min)
npx hedera-harness validate                      # install, lint, build, test, then renders core routes
```

`local-gate.sh` reads the template from GitHub, so push the branch first and pass it as `owner/repo#branch`.

## Hedera Harness

The recipe is in `.harness/` (schema v3, `hedera-harness` pinned to `2.0.0-rc.4`). `validate` and `doctor` run without an agent or keys. `yarn harness:run` starts an agent run on a new `harness/run-*` branch and needs a clean tree. Chain validation, when enabled, reads `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` from the shell; never write them to a file in the repository.
