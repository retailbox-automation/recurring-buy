# Recurring Buy: a scaffold-hbar template

Buy a token on SaucerSwap on a schedule: the same amount every hour, day or week. Hedera runs every purchase itself, and your tokens stay in your wallet until the moment each one is spent.

This is a [scaffold-hbar](https://docs.hedera.com/solutions/tools/scaffold-hbar/index) template: a Solidity contract, its tests, and a Next.js app in one workspace, for Hedera testnet and mainnet.

## What it does

You describe a plan: "buy SAUCE with 0.05 WHBAR every day, four times, and never accept less than 1.94 SAUCE for a buy". Then:

1. **Limit.** You approve the contract for the plan's total on the token you spend (an HTS allowance). The tokens stay in your wallet. The allowance is the most the contract can ever take, and you can revoke it at any time.
2. **Tick.** At the scheduled second the Hedera Schedule Service calls the contract ([HIP-1215](https://hips.hedera.com/hip/hip-1215)). There is no keeper bot and no server: the contract asked the network for this call, and the network makes it.
3. **Swap.** The contract takes one buy's worth from your wallet and swaps it on SaucerSwap V2 with your account as the recipient. If the pool would give less than your price floor, the tick is skipped: nothing is taken.
4. **Next tick.** As its last step the tick schedules the next one.

Steps 2 to 4 repeat until the plan has run all its ticks, you stop it, or your allowance or balance runs out. Every plan pays for its own ticks from a gas deposit in HBAR, and whatever it does not spend comes back to you. [docs/how-it-works.md](docs/how-it-works.md) explains why this needs no bot on Hedera.

## Create a project from this template

```bash
npx create-scaffold-hbar@latest my-app --template retailbox-automation/recurring-buy
```

With `npm create`, put `--` before the CLI's flags: `npm create scaffold-hbar@latest my-app -- --template <owner/repo>`. Without `--`, `npm` keeps `--template` for itself: npm@12 stops with `EUNKNOWNCONFIG Unknown cli flags: --template`, and npm@10 drops the flag, so the CLI falls back to its interactive template prompt. Add `--package-manager npm` for an npm-based project. The examples below use Yarn; in an npm-based project the same scripts run as `npm run <script>`.

## Prerequisites

- Node.js 20.18.3 or later
- Git with `user.name` and `user.email` set (the CLI makes the first commit)
- Yarn (`corepack enable` installs it), or npm, for npm-based projects
- To deploy or to start a plan: a Hedera testnet account with HBAR from the [portal faucet](https://portal.hedera.com/faucet), and an EVM wallet set to Hedera Testnet (chain id 296)

## Look at it first: no wallet, no `.env`

Run `yarn next:dev` and open http://localhost:3000. The home page explains the flow and shows the reference plan set in `packages/nextjs/scaffold.config.ts`, read from the mirror node. `/plans/new` is the form for a plan and `/plans` lists the plans of the connected wallet.

## Deploy the contract to testnet

`RecurringBuy` needs the Schedule Service, so there is nothing to deploy on a local chain. Until you deploy your own, the app uses the contract of the reference plan.

### Deploy with Hardhat

```bash
yarn hardhat:account:generate   # a deployer key, stored encrypted in packages/hardhat/.env
yarn hardhat:deploy:testnet     # asks for the key's password
```

Fund the deployer's address from the faucet between the two commands. The deploy writes the address and ABI to `packages/nextjs/contracts/deployedContracts.ts`, and the app starts using that contract. It used 2,176,533 gas, 2.37 HBAR, on testnet. To show the source on Hashscan, verify it with Sourcify's v2 API as in [packages/hardhat/README.md](packages/hardhat/README.md#verify-the-source): `yarn hardhat:verify:testnet` calls the v1 API, which answered 404 when we tried it. The contract's tests run on mocks: `yarn hardhat:test`.

## Start a plan: what you sign and what it costs

On `/plans/new` you fill in the pair, the amount per buy, the period, the number of buys and the price floor. Before you sign anything, the page shows a live quote from SaucerSwap's QuoterV2 and every transaction with its gas. You sign up to five, each skipped when it is already done:

| # | Transaction | Gas on testnet |
| --- | --- | --- |
| 1 | Associate the token you buy (HIP-719), even if your account associates tokens automatically | 726,488 gas, 0.79 HBAR |
| 2 | Associate WHBAR, if you need to wrap some | 726,488 gas, 0.79 HBAR |
| 3 | Wrap HBAR into WHBAR through SaucerSwap's WhbarHelper, as much as the plan is short of | 77,966 gas, 0.085 HBAR |
| 4 | Approve the contract for the plan's total on the token you spend | 727,032 gas, 0.79 HBAR |
| 5 | Start the plan and pay its gas deposit | 1,637,955 gas, 1.79 HBAR; 1,476,561 gas more for the first plan on a spend token |

After that nobody signs anything. A tick costs about 1.75 HBAR in gas whatever the size of the buy, paid from the plan's gas deposit. The app reserves 4.332 HBAR per tick up front, and what the ticks do not use comes back to you. Reservations, settlement and gas prices in detail: [docs/costs.md](docs/costs.md).

## Stop a plan

- On `/plans`, **Stop and refund deposit** calls `stop(planId, refundTo)`. The contract asks Hedera to delete the pending tick's schedule and sends you the deposit. If Hedera confirms the deletion, the pending tick's reservation comes back too.
- Or revoke the allowance: approve 0 on the token you spend. This needs nothing from the contract. The next tick fails to take its amount, ends the plan and buys nothing.
- A plan that has ended by itself (all ticks done, allowance or balance short, deposit too low for another reservation) keeps what is left of its deposit until you press **Withdraw** on `/plans`.

## Verified on testnet

This template's contract, deployed from this repository on 2026-09-30, and the reference plan the home page shows. Nobody sent a transaction for any tick: the network ran each one at its scheduled second. To check a tick yourself, see [docs/verify-ticks.md](docs/verify-ticks.md).

| What | Link |
| --- | --- |
| RecurringBuy contract, source verified on Sourcify (exact match) | [0.0.10795675](https://hashscan.io/testnet/contract/0.0.10795675) |
| Plan #1 (0.05 WHBAR → SAUCE every 5 minutes, 4 buys): `start` transaction | [1790790834.555078365](https://hashscan.io/testnet/transaction/1790790834.555078365) |
| Tick 1, run by the network: bought 2.044654 SAUCE and scheduled tick 2 | schedule [0.0.10795766](https://hashscan.io/testnet/schedule/0.0.10795766), run at [1790791132.086448208](https://hashscan.io/testnet/transaction/1790791132.086448208) |
| Ticks 2 to 4: bought, bought, bought and completed the plan | [1790791430.054047190](https://hashscan.io/testnet/transaction/1790791430.054047190), [1790791728.078691208](https://hashscan.io/testnet/transaction/1790791728.078691208), [1790792026.001025208](https://hashscan.io/testnet/transaction/1790792026.001025208) |
| Withdraw: the unused deposit of plan #1 back to its owner | [1790792048.020794657](https://hashscan.io/testnet/transaction/1790792048.020794657) |
| A skipped tick: plan #2's floor was above the price, nothing taken, next tick scheduled | schedule [0.0.10795970](https://hashscan.io/testnet/schedule/0.0.10795970), run at [1790792373.084332104](https://hashscan.io/testnet/transaction/1790792373.084332104) |
| `stop`: pending schedule deleted, deposit and its reservation refunded | [1790792387.304319777](https://hashscan.io/testnet/transaction/1790792387.304319777); schedule [0.0.10796029](https://hashscan.io/testnet/schedule/0.0.10796029) deleted, never run |
| Wrap 0.1 HBAR into WHBAR with the transaction `/plans/new` sends | [1790794391.315370441](https://hashscan.io/testnet/transaction/1790794391.315370441) |

Gas, fees and balances for every row are in runs E and G of [docs/testnet-findings.md](docs/testnet-findings.md). Before this template, a prototype of the contract ran the same mechanism: [0.0.10777783](https://hashscan.io/testnet/contract/0.0.10777783), run B.

## Environment variables

None is required: the app builds and runs without a `.env`.

| Variable | File | Purpose |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | `packages/hardhat/.env` | The deployer key, written by `yarn hardhat:account:generate` or `yarn hardhat:account:import`. Do not fill it in by hand |
| `HEDERA_RPC_URL` | `packages/hardhat/.env` | JSON-RPC endpoint the Hardhat network forks from. Default: hashio testnet |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL`, `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL` | `packages/nextjs/.env.local` | JSON-RPC endpoints for the app. Default: hashio |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `packages/nextjs/.env.local` | Your WalletConnect project id |
| `NEXT_PUBLIC_ENABLE_BURNER_WALLET` | `packages/nextjs/.env.local` | `true` adds a burner wallet whose key lives in the browser. For automated tests and local demos only. Read at build time |

## More

[How it works](docs/how-it-works.md) (the contract, the Hedera services in a tick, the layout, known limitations) · [Costs](docs/costs.md) · [Checking a tick](docs/verify-ticks.md) · [Template checks and Hedera Harness](docs/checks.md) · [Everything measured on testnet](docs/testnet-findings.md) · [AGENTS.md](AGENTS.md), for changing the template with or without a coding agent.

## License

MIT, see [LICENSE](LICENSE). The starter is Copyright (c) 2023 BuidlGuidl and (c) 2026 hedera-dev; [PROVENANCE.md](PROVENANCE.md) lists what is starter code and what was added.
