# Recurring Buy: a scaffold-hbar template

Buy a token on SaucerSwap on a schedule: the same amount every hour, day or week. Hedera runs every purchase itself, and your tokens stay in your wallet until the moment each one is spent.

This is a [scaffold-hbar](https://docs.hedera.com/solutions/tools/scaffold-hbar/index) template: a Solidity contract, its tests, and a Next.js app in one workspace, for Hedera testnet and mainnet.

## What it does

You describe a plan: "buy SAUCE with 0.05 WHBAR every day, four times, and never accept less than 1.94 SAUCE for a buy". Then:

1. **Limit.** You approve the contract for the plan's total on the token you spend (an HTS allowance). The tokens stay in your wallet. The allowance is the most the contract can ever take, and you can revoke it at any time.
2. **Tick.** At the scheduled second the Hedera Schedule Service calls the contract ([HIP-1215](https://hips.hedera.com/hip/hip-1215)). There is no keeper bot and no server: the contract asked the network for this call, and the network makes it.
3. **Swap.** The contract takes one buy's worth from your wallet and swaps it on SaucerSwap V2 with your account as the recipient. If the pool would give less than your price floor, the tick is skipped: nothing is taken.
4. **Next tick.** As its last step the tick schedules the next one.

Steps 2 to 4 repeat until the plan has run all its ticks, you stop it, or your allowance or balance runs out.

Every plan pays for its own ticks from a gas deposit in HBAR. A tick charges the plan the gas it used, and whatever the plan does not spend comes back to you.

### Why it needs SaucerSwap and the Schedule Service

Take SaucerSwap away and a tick has nothing to do: the swap is the purchase. Take the Schedule Service away and somebody has to run a bot with a funded key that calls the contract on time, which is how recurring buys work on other EVM chains. On Hedera a contract can schedule a call to itself and pay for it, so the template has no off-chain part at all. The app only reads: it shows what the mirror node recorded.

## Create a project from this template

```bash
npx create-scaffold-hbar@latest my-app --template retailbox-automation/recurring-buy
```

The same command through `npm create` needs `--` before the CLI's flags: `npm create scaffold-hbar@latest my-app -- --template <owner/repo>`. Without `--`, `npm` keeps `--template` for itself: npm@12 stops with `EUNKNOWNCONFIG Unknown cli flags: --template`, and npm@10 drops the flag, so the CLI falls back to its interactive template prompt.

Add `--package-manager npm` for an npm-based project. The examples below use Yarn; in an npm-based project the same scripts run as `npm run <script>`.

## Prerequisites

- Node.js 20.18.3 or later
- Git with `user.name` and `user.email` set (the CLI makes the first commit)
- Yarn (`corepack enable` installs it), or npm, for npm-based projects
- To deploy or to start a plan: a Hedera testnet account with HBAR from the [portal faucet](https://portal.hedera.com/faucet), and an EVM wallet set to Hedera Testnet (chain id 296)

## Look at it first: no wallet, no `.env`

```bash
yarn next:dev
```

Open http://localhost:3000. The home page explains the flow and shows the reference plan set in `packages/nextjs/scaffold.config.ts`, read from the mirror node. `/plans/new` is the form for a plan and `/plans` lists the plans of the connected wallet.

## Deploy the contract to testnet

```bash
yarn hardhat:account:generate   # a deployer key, stored encrypted in packages/hardhat/.env
yarn hardhat:deploy:testnet     # asks for the key's password
```

Fund the deployer's address from the faucet between the two commands. The deploy script (`packages/hardhat/deploy/00_deploy_recurring_buy.ts`) passes the contract two things: SaucerSwap's V2 router for the network, and a reserve gas price of twice the gas price the relay reports at that moment (`eth_gasPrice`). It then writes the address and ABI to `packages/nextjs/contracts/deployedContracts.ts`, and the app starts using that contract.

Deploying this contract used 2,176,533 gas, 2.37 HBAR, on testnet on 2026-09-30. To show its source on Hashscan, verify it with Sourcify's v2 API: the request is in [packages/hardhat/README.md](packages/hardhat/README.md#verify-the-source) (`yarn hardhat:verify:testnet` calls the v1 API, which answered 404 when we tried it).

`RecurringBuy` needs the Schedule Service, so there is nothing to deploy on a local chain. The contract's tests run against mocks: `yarn hardhat:test`.

## Start a plan: what you sign and what it costs

On `/plans/new` you fill in the pair, the amount per buy, the period, the number of buys and the price floor. The page shows a live quote from SaucerSwap's QuoterV2 and the costs below before you sign anything. You sign at most three transactions:

| # | Transaction | What it allows | Gas on testnet |
| --- | --- | --- | --- |
| 1 | Associate your account with the token you buy (HIP-719). Skipped if you are already associated or your account associates automatically | Lets you receive that token | 726,488 gas, 0.79 HBAR |
| 2 | Approve the contract on the token you spend | The contract may take up to the plan's total, one buy at a time. Plans of one owner on the same token share this allowance | 727,032 gas, 0.79 HBAR |
| 3 | Start the plan, with the gas deposit attached | Creates the plan and schedules its first tick | 1,637,955 gas, 1.79 HBAR, plus the deposit |

The first plan on a contract for a given spend token costs more to start: the contract associates itself with that token, reads the token's supply from the Token Service and approves SaucerSwap's router for as much as the token allows, 1,476,561 gas (1.61 HBAR) more, once.

After that nobody signs anything. Ticks are paid from the plan's **gas deposit**:

- Scheduling a tick reserves `tickGasLimit × reserveGasPrice` from the deposit. The app uses a gas limit of 1,900,000. The reserve price is twice what the relay reported at deployment: on 2026-09-30 hashio reported 114 tinybar per gas on testnet (the network charged 109), which gives 228 tinybar and 1,900,000 × 228 tinybar = 4.332 HBAR per tick.
- When the tick runs, the contract measures the gas it used, charges the plan for it at the network's gas price, and puts the rest of the reservation back into the deposit. The measurement adds a fixed 40,000 gas for the bookkeeping that follows it.
- A tick that bought and scheduled the next one used 1,605,224 gas, 1.750 HBAR. The last tick of a plan, which schedules nothing, used 182,352 gas, 0.199 HBAR. A skipped tick costs about as much as a buying one: 1,610,623 gas.
- The contract charged each tick at the price the network billed it (109 tinybar per gas on testnet), for 37,000 to 39,000 gas more than the network counted: the allowance for the settlement is a little generous, and the difference, about 0.04 HBAR per tick, stays in the contract.
- The app asks for one full reservation per buy. For four buys that is 17.328 HBAR up front. The reference plan was charged 5.617 HBAR of it for its four ticks and got 11.711 HBAR back when its owner withdrew.

Scheduling the next tick is most of a tick's gas (a tick that schedules nothing used 182,352 of the 1,605,224), and the amount you buy does not change it. A buy therefore costs about 1.75 HBAR in gas whatever its size.

All gas figures are from this template's contract on testnet on 2026-09-30, at 109 tinybar per gas: see run E in [docs/testnet-findings.md](docs/testnet-findings.md).

To try the default pair on testnet you need WHBAR, which is HBAR wrapped by the WHBAR contract `0.0.15057`: send HBAR to its `deposit()` function.

## Stop a plan

- On `/plans`, **Stop and refund deposit** calls `stop(planId, refundTo)`. The contract asks Hedera to delete the pending tick's schedule and sends you the deposit. If Hedera confirms the deletion, the pending tick's reservation comes back too.
- Or revoke the allowance: approve 0 on the token you spend. This needs nothing from the contract. The next tick fails to take its amount, ends the plan and buys nothing.
- A plan that has ended by itself (all ticks done, allowance or balance short, deposit too low for another reservation) keeps what is left of its deposit until you press **Withdraw** on `/plans`.

## Check that a tick really ran

The wallet only confirms that the plan was created. A tick is a separate transaction that the network starts, so check it on the network:

1. Each `TickScheduled` event of the contract carries the schedule's address. As a Hedera id it opens on Hashscan: `https://hashscan.io/testnet/schedule/0.0.<N>`. The app links it next to every tick.
2. The mirror node's `/api/v1/schedules/0.0.<N>` shows `executed_timestamp` once the network has run it.
3. `/api/v1/contracts/<contract id>/results/<executed_timestamp>` is the tick itself: `SUCCESS` or `CONTRACT_REVERT_EXECUTED`, with the gas used. On Hashscan: `https://hashscan.io/testnet/transaction/<executed_timestamp>`.
4. `/api/v1/transactions?timestamp=<executed_timestamp>` shows who paid: the transfer out of the contract's account is the tick's fee.

Read a tick by its timestamp, as above. The mirror node's `/contracts/results/<transaction id>?nonce=<n>` can return the call that scheduled the tick instead of the tick (finding B7 in the testnet notes). For the same reason the app takes a plan's status from the execution of its last schedule, not from the contract's `active` flag.

## Verified on testnet

This template's contract, deployed from this repository on 2026-09-30, and the reference plan the home page shows. Nobody sent a transaction for any tick: the network ran each one at its scheduled second.

| What | Link |
| --- | --- |
| RecurringBuy contract, source verified on Sourcify (exact match) | [0.0.10795675](https://hashscan.io/testnet/contract/0.0.10795675) |
| Plan #1 (0.05 WHBAR → SAUCE every 5 minutes, 4 buys): `start` transaction | [1790790834.555078365](https://hashscan.io/testnet/transaction/1790790834.555078365) |
| Tick 1, run by the network: bought 2.044654 SAUCE and scheduled tick 2 | schedule [0.0.10795766](https://hashscan.io/testnet/schedule/0.0.10795766), run at [1790791132.086448208](https://hashscan.io/testnet/transaction/1790791132.086448208) |
| Ticks 2 to 4: bought, bought, bought and completed the plan | [1790791430.054047190](https://hashscan.io/testnet/transaction/1790791430.054047190), [1790791728.078691208](https://hashscan.io/testnet/transaction/1790791728.078691208), [1790792026.001025208](https://hashscan.io/testnet/transaction/1790792026.001025208) |
| Withdraw: the unused deposit of plan #1 back to its owner | [1790792048.020794657](https://hashscan.io/testnet/transaction/1790792048.020794657) |
| A skipped tick: plan #2's floor was above the price, nothing taken, next tick scheduled | schedule [0.0.10795970](https://hashscan.io/testnet/schedule/0.0.10795970), run at [1790792373.084332104](https://hashscan.io/testnet/transaction/1790792373.084332104) |
| `stop`: pending schedule deleted, deposit and its reservation refunded | [1790792387.304319777](https://hashscan.io/testnet/transaction/1790792387.304319777); schedule [0.0.10796029](https://hashscan.io/testnet/schedule/0.0.10796029) deleted, never run |

Gas, fees and balances for every row are in run E of [docs/testnet-findings.md](docs/testnet-findings.md). Before this template, a prototype of the contract ran the same mechanism: [0.0.10777783](https://hashscan.io/testnet/contract/0.0.10777783), run B.

## Environment variables

None is required: the app builds and runs without a `.env`.

| Variable | File | Purpose |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | `packages/hardhat/.env` | The deployer key, written by `yarn hardhat:account:generate` or `yarn hardhat:account:import`. Do not fill it in by hand |
| `HEDERA_RPC_URL` | `packages/hardhat/.env` | JSON-RPC endpoint the Hardhat network forks from. Default: hashio testnet |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL`, `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL` | `packages/nextjs/.env.local` | JSON-RPC endpoints for the app. Default: hashio |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `packages/nextjs/.env.local` | Your WalletConnect project id |
| `NEXT_PUBLIC_ENABLE_BURNER_WALLET` | `packages/nextjs/.env.local` | `true` adds a burner wallet whose key lives in the browser. For automated tests and local demos only. Read at build time |

## How it is built

```
packages/hardhat     RecurringBuy.sol, its mocks and tests, the deploy script
packages/nextjs      the app: /, /plans/new, /plans, plus the starter's Debug Contracts and block explorer
packages/saucerswap  @sh/saucerswap: SaucerSwap V2 addresses, quotes, swap paths, HTS association, relay gas price
docs                 what was measured on testnet
tools/gate           the template's eligibility checks
.harness             Hedera Harness recipe and validators
template.json        the manifest create-scaffold-hbar reads
```

`RecurringBuy` holds every plan. Its surface is small:

| Function | Who calls it | What it does |
| --- | --- | --- |
| `start(params)` payable | the owner | Stores the plan, takes the gas deposit, schedules tick 1 one period ahead |
| `tick(planId)` | the Schedule Service, as the contract itself | Runs `buy` under `try`/`catch`, then ends the plan or schedules the next tick, then charges the plan for its gas |
| `buy(planId)` | `tick`, through a self-call | Pulls one buy's worth from the owner and swaps it to the owner. A failed pull and a failed swap revert differently, so `tick` can stop the plan on the first and skip on the second |
| `topUp(planId)` payable | anyone | Adds to a running plan's gas deposit |
| `stop(planId, refundTo)` | the owner | Deletes the pending schedule, ends the plan, refunds the deposit |
| `plans(planId)` | anyone | The plan's state |

The app rebuilds a plan's history from the contract's events (`PlanCreated`, `TickScheduled`, `TickExecuted`, `TickSkipped`, `PlanStopped`, `GasDepositAdded`, `GasRefunded`) and from the mirror node's record of each schedule. That code is in `packages/nextjs/utils/recurring-buy/` and has no React in it, so its tests run on recorded mirror node responses: `yarn next:test`.

Three Hedera services meet in one tick: the Schedule Service starts it (HIP-1215 `scheduleCall`, with `hasScheduleCapacity` before it and `deleteSchedule` at `stop`), the Token Service moves the tokens (an HTS allowance, HIP-719 association, and `getTokenInfo` for the router's approval: a token with a finite supply accepts no more than its maximum supply), and the Smart Contract Service runs the contract. The app reads the outcome from the mirror node.

## Template checks

| Command | What it checks |
| --- | --- |
| `yarn hardhat:test` | the contract, on mocks of the Schedule Service, the Token Service, an HTS token and the router |
| `yarn next:test` | the app's plan history and mirror node code, on recorded testnet responses |
| `yarn saucerswap:test` | the SaucerSwap client |
| `yarn lint` | all three packages |
| `yarn gate:test` | the gate tools themselves: each check passes on good input and fails on broken input |
| `yarn gate:manifest` | `template.json` against the schema of create-scaffold-hbar, and against the packages in this repository |
| `yarn gate:secrets` | secrets and `.env` files in the working tree and the whole git history |
| `yarn gate:local` | the full gate on the last local commit, before it is pushed (Yarn leg) |
| `bash tools/gate/local-gate.sh <owner/repo[#ref]> <package-manager> [--strict]` | the full gate on a fresh scaffold from GitHub |

`local-gate.sh` scaffolds the template with create-scaffold-hbar into a temporary directory (with `--local` the CLI copies the last commit instead of downloading it), then runs install, lint with zero warnings, type checks, contract compile and `next build` with an empty environment. It starts the built app without a `.env` and requests every route listed in `.harness/validators/playwright-smoke.yaml`. It also scans the scaffold and the repository history for secrets and checks the MIT licence. Until this README carries a testnet transaction link the testnet item shows `PENDING`; `--strict` turns that into a failure.

`.github/workflows/gate.yml` runs the same gate on Node 20.18.3, 22 and 24, for Yarn, npm@10 and npm@12. It runs only in a repository that has `template.json`. The CLI deletes that file from the projects it creates, so there the workflow stays idle, and `tools/gate/` and `gate.yml` can be deleted.

### Hedera Harness

```bash
npx hedera-harness doctor     # checks the setup; no agent, no keys
npx hedera-harness validate   # install, lint, build, test, secret scan, then renders the core routes
```

The recipe, its pinned version and the steps for npm-based projects are in [.harness/README.md](.harness/README.md).

## Known limitations

- **Testnet and mainnet only.** Ticks need the Schedule Service, which a local chain does not have. The mainnet router address is taken from SaucerSwap's documentation and has not been exercised by us.
- **A buy costs about 1.75 HBAR in gas whatever its size**, because each tick pays for scheduling the next one. Small, frequent buys are poor value.
- **The reserve gas price is fixed at deployment**, at twice the relay's gas price of that moment. A tick never costs a plan more than its reservation. If the network's gas price in tinybar rises above the reserve price, ticks cost the contract more than plans pay for them, and the contract should be redeployed.
- **The price floor is an absolute amount, set once.** If the price moves away for good, every tick is skipped, and each skipped tick still pays for scheduling the next one.
- **One hop.** A plan swaps through a single SaucerSwap V2 pool. The token you spend must be an HTS token, so HBAR has to be wrapped first.
- **A tick that reverts as a whole breaks the chain.** Pull and swap failures are caught, but a tick that runs out of gas takes its own bookkeeping with it: the contract still calls the plan active while nothing is scheduled. The app shows this as "Chain broken". `stop` recovers the deposit, but not that tick's reservation.
- **If Hedera does not delete the pending schedule at `stop`**, that tick still runs, reverts, and its reservation stays in the contract.
- **Ticks drift.** Inside a tick `block.timestamp` was one or two seconds before the scheduled second, and the next tick is scheduled one period after it, so each tick lands a second or two earlier than a whole period.
- **Schedule seconds are predictable.** When a second has no capacity the contract tries the seconds 1, 2, 4, 8 and 16 later, without a random offset.
- **No audit.** The contract has tests, not a security review.

Checked on testnet with this contract: a four-tick plan with a 5-minute period, the gas settlement of every tick against the fee the network charged, a skipped tick, and `stop` deleting a pending schedule. Not yet checked on a live network: periods of hours or days, a plan that spends a finite-supply token (only simulated), a tick that fails to take its amount, a busy schedule second, a tick that runs out of gas, a browser wallet, and mainnet.

## License

MIT, see [LICENSE](LICENSE). The starter is Copyright (c) 2023 BuidlGuidl and (c) 2026 hedera-dev; [PROVENANCE.md](PROVENANCE.md) lists what is starter code and what was added.
