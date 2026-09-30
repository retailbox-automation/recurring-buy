# Agent instructions

Briefing for coding agents (Claude Code, Cursor, Codex) working in this repository or in a project created from it. Claude Code loads it through `CLAUDE.md`. Read [README.md](README.md) first for what the template does; this file is about how to change it without breaking it.

## What this is

A scaffold-hbar template for recurring buys on SaucerSwap V2. One contract, `RecurringBuy`, holds every plan. Once per period the Hedera Schedule Service (HSS, system contract `0x16b`, HIP-1215) calls the contract's `tick`, which takes one buy's worth from the plan owner under an HTS allowance, swaps it on SaucerSwap to the owner, and schedules the next tick.

- `packages/hardhat`: `RecurringBuy.sol`, mocks, tests, deploy script (Hardhat, hardhat-deploy). Hardhat only; there is no Foundry package.
- `packages/nextjs`: the app (Next.js App Router, RainbowKit, wagmi, viem, DaisyUI).
- `packages/saucerswap`: `@sh/saucerswap`, a SaucerSwap V2 client with no React in it. See its README.
- `docs/testnet-findings.md`: what two prototype runs and this contract (run E) measured on testnet. Code comments cite it by label (`A3`, `B7`).

## Package manager

Use the one the project was created with (`packageManager` in the root `package.json`, or the lockfile). Examples use Yarn. In an npm-based project scripts run as `npm run <script>`, and extra arguments need `--` first.

## Commands

```bash
yarn next:dev                    # the app, http://localhost:3000; needs no wallet and no .env
yarn hardhat:test                # contract tests, on mocks
yarn next:test                   # plan history and mirror node code, on recorded testnet responses
yarn saucerswap:test             # SaucerSwap client; saucerswap:test:live also calls testnet
yarn lint                        # all three packages; the gate adds --max-warnings=0
yarn next:check-types
yarn hardhat:check-types
yarn hardhat:compile
yarn next:build

yarn hardhat:account:generate    # encrypted deployer key in packages/hardhat/.env
yarn hardhat:deploy:testnet      # deploys RecurringBuy to Hedera testnet, asks for the key's password
```

`yarn hardhat:deploy` on any network other than `hederaTestnet` and `hederaMainnet` deploys nothing: the script skips `RecurringBuy` where there is no Schedule Service. The Hardhat network forks testnet through hashio, so `yarn hardhat:test` needs network access.

## Where things live

- Contract: `packages/hardhat/contracts/RecurringBuy.sol`. Interfaces for the four things it calls are in `contracts/interfaces/`, their test stand-ins in `contracts/mocks/`.
- Contract tests: `packages/hardhat/test/RecurringBuy.test.ts`. The fixture puts `MockScheduleService` at `0x16b` and `MockTokenService` at `0x167` with `hardhat_setCode`. `runTick` plays the network: it replays the latest scheduled call from the contract's own address, with the scheduled gas limit.
- Deploy script: `packages/hardhat/deploy/00_deploy_recurring_buy.ts`. After a deploy, the address and ABI are written to `packages/nextjs/contracts/deployedContracts.ts`.
- The app's contract ABI: `packages/nextjs/utils/recurring-buy/abi.ts`, written out by hand so the app builds before any deployment and can read a contract it did not deploy. `abi.test.ts` compares it with the compiled artifact, so run `yarn hardhat:compile` before `yarn next:test`.
- Plan history and status: `packages/nextjs/utils/recurring-buy/plan.ts` and `mirror.ts`. Hooks: `packages/nextjs/hooks/recurring-buy/useRecurringBuy.ts`. Screens: `packages/nextjs/components/recurring-buy/`, routes `/`, `/plans/new`, `/plans`.
- Which contract the app uses: its own deployment from `deployedContracts.ts`, otherwise `referencePlan.contract` in `packages/nextjs/scaffold.config.ts`.
- Networks: `packages/hardhat/hardhat.config.ts` (`hederaTestnet` 296, `hederaMainnet` 295) and `packages/nextjs/scaffold.config.ts`.
- Next.js imports use the `~~` alias; pages that use hooks need `"use client"`.

## Addresses

| | Testnet | Mainnet |
| --- | --- | --- |
| Hedera Schedule Service | `0x16b` | `0x16b` |
| Hedera Token Service | `0x167` | `0x167` |
| SaucerSwap V2 SwapRouter | `0.0.1414040` | `0.0.3949434` |
| SaucerSwap V2 QuoterV2 | `0.0.1390002` | `0.0.3949424` |
| WHBAR token | `0.0.15058` | `0.0.1456986` |
| SaucerSwap WhbarHelper (wraps HBAR) | `0.0.5286055` | `0.0.5808826` |

They are defined once, in `packages/saucerswap/src/addresses.ts`; the deploy script repeats the two router addresses. The testnet ones have carried our transactions. The mainnet ones are from SaucerSwap's documentation and have not been exercised. An HTS token's or contract's EVM address is its id as a 20-byte number: `hederaIdToLongZeroAddress("0.0.15058")`.

## Invariants of the contract

Each of these was learned on testnet or is a rule of the Schedule Service. Break one and ticks stop running, usually without an error anywhere.

1. **A tick is guarded by its sender, never by time.** `tick` requires `msg.sender == address(this)`: a call scheduled with `scheduleCall` arrives from the contract that scheduled it (B2). Do not add `block.timestamp >= expiry`: inside a tick `block.timestamp` was one or two seconds before the scheduled second (B3).
2. **`scheduleCall` is the last scheduling call of an execution.** After a contract has scheduled a recursive call, any further scheduling in the same execution fails with `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION` (373). `tick` schedules exactly once, after the swap and after every decision. The test "schedules the next tick exactly once, as its last external call" reads the opcode trace to hold this.
3. **Nothing that can fail runs in `tick` itself.** A revert of the whole tick also undoes the next schedule and the tick's own bookkeeping: the plan stays `active` and nothing will ever run it again (B9). The pull and the swap run in `buy`, a self-call under `try`/`catch`. `buy` reverts with `PullFailed` when the owner's tokens cannot be taken, and with the router's own data when the swap fails, so `tick` can stop the plan on the first and skip on the second.
4. **Keep gas back for the next schedule.** `scheduleCall` took 1.41 million gas on testnet (B5). `tick` gives `buy` all its gas except `RESCHEDULE_GAS`, so a swap that burns everything it is given still leaves enough to schedule. `start` rejects a `tickGasLimit` at or below `RESCHEDULE_GAS`.
5. **The Schedule Service never reverts.** Every call returns a HAPI response code; 22 is success. Check it each time, as `_scheduleTick` and `stop` do.
6. **A plan pays for its own ticks.** The contract is the payer of every tick, so all plans share one HBAR balance. Scheduling a tick moves `tickGasLimit * reserveGasPrice` out of the plan's deposit. `_chargeTick` is the last statement of every path through `tick`: it charges the plan the gas used so far plus `SETTLEMENT_GAS`, at `tx.gasprice` capped by `reserveGasPrice`, and returns the rest of the reservation. It computes the gas used as `tickGasLimit - gasleft()`, which holds because a tick always runs with the gas limit its schedule was created with. Anything you add after `_chargeTick` has to fit in `SETTLEMENT_GAS`; the tests "charges a tick…" and "covers the settlement…" measure that from the opcode trace. On testnet `tx.gasprice` inside a scheduled call was the price Hedera billed for it, and every tick charged its plan slightly more than the network billed the contract (E2, E3). If you change the tick, compare a `TickCharged` event with the fee of its transaction again.
7. **`nonReentrant` on everything that moves money.** Tokens and pools are external code. The test "skips the tick when a token or pool calls back into the contract" shows what a callback could otherwise do.
8. **Units.** Inside the EVM, HBAR is counted in tinybar (8 decimals): `msg.value`, `reserveGasPrice`, the deposit. Over JSON-RPC it is counted in weibar (18 decimals): the app multiplies the deposit by 10^10 before sending it as `value`, and the deploy script divides `eth_gasPrice` by 10^10. HTS amounts are `int64`.
9. **HTS rules.** An account or contract must be associated with a token before it can receive it (HIP-719 `associate()`, sent to the token's address). The HTS facade's `transferFrom` reverts with no data when the allowance or the balance is short. The first plan for a spend token makes the contract associate itself and approve the router once (`_prepareToken`), for the most the token accepts: the largest `int64` if its supply is infinite, its maximum supply if that is finite, read with `getTokenInfo` from the Token Service at `0x167`. A finite-supply token refuses anything above its maximum supply (D1). Every swap uses up part of that approval.

Other limits worth knowing: a second with no capacity returns `SCHEDULE_EXPIRY_IS_BUSY` (370), which is why `_secondWithCapacity` probes later seconds; and the network caps how many times a contract may schedule recursive calls (`RECURSIVE_SCHEDULING_LIMIT_REACHED`, 374; about four million with typical configuration, according to the response code's description).

## Invariants of the app

1. **A plan's status comes from the mirror node, not from the contract's `active` flag** (B9). `chainStatus` in `plan.ts` looks at the last tick's schedule.
2. **Read a tick by timestamp:** the schedule's `executed_timestamp`, then `/contracts/{contractId}/results/{timestamp}`. `/contracts/results/{transactionId}?nonce=N` can return the call that created the schedule instead (B7), and lists need `internal=true` to show scheduled calls at all (A9).
3. **Do not trust `from` or the schedule's creator on the mirror node.** They name the hashio relay (B2, B6). Follow a plan through the contract's events.
4. **The mirror node never marks a schedule as expired** (A7). `scheduleState` computes "missed" from the clock.
5. **Fees through hashio come from `eth_gasPrice`** (C1): use `useHederaFees`. Fees derived from the block header are rejected. Costs shown to a person use the price the network bills, from the mirror node's `/network/fees` (`useGasPrice`): `eth_gasPrice` adds the relay's margin (C4).
6. **The app builds and boots with no `.env`.** `tools/gate/local-gate.sh` runs `next build` and `next start` in an empty environment and requests every core route. Fetch live data on the client and show an error state when a node or API is unreachable; do not fetch at build time.
7. **Associate before a tick needs it.** `/plans/new` asks for an explicit association of the token a plan buys, even when the account associates tokens automatically: an automatic association inside a tick's swap takes more gas than `buy` gets (D3). It also associates WHBAR before wrapping HBAR, as SaucerSwap asks (D2). The list of transactions and their gas comes from `stepsToSign` in `utils/recurring-buy/costs.ts`.
8. Core routes are listed in `.harness/validators/playwright-smoke.yaml`. Add a route there when you add a page that matters.
9. When the contract's ABI changes, update `utils/recurring-buy/abi.ts` for whatever the app calls or reads.

## Extending it

- **Another pair or fee tier:** nothing to change in the contract. A plan names `tokenIn`, `fee` and `tokenOut`; the form accepts any HTS token id. On testnet only the WHBAR/SAUCE pool at fee 3000 is known to exist (docs/testnet-findings.md).
- **A multi-hop path:** `buy` builds the path with `abi.encodePacked(tokenIn, fee, tokenOut)`. Store a `bytes path` in the plan instead, and raise the gas estimates in `NewPlanForm.tsx`.
- **A different action per tick** (rebalance, claim, pay): replace the body of `buy`. Keep it a self-call that reverts on failure, keep `tick` free of anything that can fail, and keep `_chargeTick` last.
- **Spending HBAR directly:** a tick has no HBAR of the owner's to spend; the owner must hold WHBAR. `/plans/new` wraps HBAR into WHBAR through SaucerSwap's WhbarHelper (`buildWrapHbar` in `@sh/saucerswap`). Wrapping inside the contract would mean the contract holds the owner's funds between ticks, which this design avoids.

Write the test first. Every behaviour of `tick` has a test in `RecurringBuy.test.ts`; add yours next to it.

## Rules for changes

- Never commit a private key, token or `.env` file. Only `.env.example` files are tracked, and values of key-like variables in them stay empty.
- Keep `template.json` in step with `packages/`: its capabilities must name only packages that exist. Run `yarn gate:manifest` after editing it.
- Lint allows zero warnings. Prefer `type` over `interface`; comments should add information.
- A number in a doc or a comment comes from code or from `docs/testnet-findings.md`. If you measure something new on a network, add it there with the transaction's link.
- Write docs for both package managers. In npm-based projects create-scaffold-hbar rewrites every `yarn`/`Yarn` in text files (except under `.harness/`) to `npm`, then turns any `npm <word>` into `npm run <word>`, prose included. So follow a package-manager name with punctuation or a backtick, not a word; do not append flags to a `yarn <script>` example (`npm` needs `--` before flags), and give the command its own script in `package.json` instead, as `hardhat:deploy:testnet` does.

## Checking your work

```bash
yarn hardhat:test && yarn next:test && yarn saucerswap:test
yarn lint && yarn next:check-types && yarn hardhat:check-types
yarn gate:test                                   # gate tools: every check has a must-fail twin
yarn gate:manifest                               # template.json vs the create-scaffold-hbar schema
yarn gate:secrets                                # secrets and .env in the tree and git history
yarn gate:local                                  # full gate on a fresh scaffold of the last local commit
bash tools/gate/local-gate.sh <owner/repo[#branch]> <package-manager>   # the same from GitHub, e.g. for the npm leg
npx hedera-harness validate                      # install, lint, build, test, then renders core routes
```

`yarn gate:local` gates committed work only: commit first. Given `owner/repo#branch`, `local-gate.sh` reads the template from GitHub instead, which also checks the default branch and GitHub's licence detection.

## Hedera Harness

The recipe is in `.harness/` (schema v3, `hedera-harness` pinned to `2.0.0-rc.4`). `validate` and `doctor` run without an agent or keys. `yarn harness:run` starts an agent run on a new `harness/run-*` branch and needs a clean tree. Chain validation, when enabled, reads `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` from the shell; never write them to a file in the repository.
