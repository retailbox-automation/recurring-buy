# Recurring Buy: brief for Hedera Harness

`yarn harness:run` gives this file to a coding agent as the feature to build. The template ships with no feature written here: the sections below describe the app as it is, so that a run keeps it working. Write your feature under "Feature to implement" and commit it before the run; the harness starts only from a clean tree. Commands below are written for Yarn; in an npm project run them as `npm run <script>`.

## Who it is for

Developers extending a project created from the Recurring Buy template.

## Existing app (preserve)

- **Contract.** `RecurringBuy`, in `packages/hardhat/contracts/` or `packages/foundry/contracts/` (a project has one of the two; the template repository keeps both copies the same, byte for byte). `start` stores a plan, takes its gas deposit in HBAR and schedules the first tick with the Hedera Schedule Service (HIP-1215 `scheduleCall`). At its scheduled second each `tick` takes one buy's worth of the owner's token under an HTS allowance, swaps it on SaucerSwap V2 to the owner, or skips the buy when the pool gives less than the plan's price floor, then schedules the next tick. `topUp` adds to a plan's gas deposit. `stop` deletes the pending schedule, ends the plan and refunds the deposit; on a plan that has already ended it returns what is left of the deposit.
- **Invariants.** `AGENTS.md` lists the invariants of the contract and of the app, each learned on testnet or required by the Schedule Service. Breaking one usually stops ticks without an error anywhere.
- **App** (`packages/nextjs`). `/` explains the flow and shows a reference plan read from the mirror node. `/plans/new` builds a plan, quotes it with SaucerSwap's QuoterV2 and lists every transaction with its gas before anything is signed. `/plans` lists the connected wallet's plans with their history, and stops them or withdraws what is left of their deposit. `/debug` and `/blockexplorer` come from scaffold-hbar. Every route builds and renders with no `.env` and no wallet.
- **`@sh/saucerswap`** (`packages/saucerswap`). SaucerSwap V2 addresses, quotes and the price floor, HTS association, wrapping HBAR into WHBAR.
- **Which contract the app uses.** A deploy (`yarn hardhat:deploy:testnet` or `yarn foundry:deploy:testnet`) writes `packages/nextjs/contracts/deployedContracts.ts`. Until then the app uses the reference plan's contract from `packages/nextjs/scaffold.config.ts`.

## Feature to implement

None yet. Replace this paragraph with the change you want: what a user can do afterwards, on which route or in which contract function, and which Hedera service it uses. "Extending it" in `AGENTS.md` lists changes the design already allows: another pair or fee tier, a multi-hop path, a different action per tick.

## Non-goals

- Do not switch the package manager, and keep the scaffold-hbar and `AGENTS.md` conventions.
- Do not commit secrets or `.env` files. Chain validation reads its operator from the shell.
- Do not edit `deployedContracts.ts` by hand: a deploy writes it.
- No bot, server or cron job to run ticks: the Schedule Service runs them.

## Acceptance (deterministic)

1. `npx hedera-harness validate` passes: the commands in `.harness/validators/yarn.json` (install, lint with zero ESLint warnings, contract compile and `next build`, contract tests), no secrets, and every route in `.harness/validators/playwright-smoke.yaml` renders.
2. `yarn next:test` and `yarn saucerswap:test` pass. After a change to the contract's ABI, `packages/nextjs/utils/recurring-buy/abi.ts` matches the compiled contract; `yarn next:test` compares them.
3. A new behaviour of `tick` has a test in the contract package: `RecurringBuy.test.ts` for Hardhat, `RecurringBuy.t.sol` for Foundry. The template repository needs both.
4. A new page that matters is listed in `.harness/validators/playwright-smoke.yaml`.
