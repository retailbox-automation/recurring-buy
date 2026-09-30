# How it works

## Why it needs SaucerSwap and the Schedule Service

Take SaucerSwap away and a tick has nothing to do: the swap is the purchase. Take the Schedule Service away and somebody has to run a bot with a funded key that calls the contract on time, which is how recurring buys work on other EVM chains. On Hedera a contract can schedule a call to itself and pay for it, so the template has no off-chain part at all. The app only reads: it shows what the mirror node recorded.

## The contract

`RecurringBuy` holds every plan. Its surface is small:

| Function | Who calls it | What it does |
| --- | --- | --- |
| `start(params)` payable | the owner | Stores the plan, takes the gas deposit, schedules tick 1 one period ahead |
| `tick(planId)` | the Schedule Service, as the contract itself | Runs `buy` under `try`/`catch`, then ends the plan or schedules the next tick, then charges the plan for its gas |
| `buy(planId)` | `tick`, through a self-call | Pulls one buy's worth from the owner and swaps it to the owner. A failed pull and a failed swap revert differently, so `tick` can stop the plan on the first and skip on the second |
| `topUp(planId)` payable | anyone | Adds to a running plan's gas deposit |
| `stop(planId, refundTo)` | the owner | Deletes the pending schedule, ends the plan, refunds the deposit |
| `plans(planId)` | anyone | The plan's state |

Three Hedera services meet in one tick: the Schedule Service starts it (HIP-1215 `scheduleCall`, with `hasScheduleCapacity` before it and `deleteSchedule` at `stop`), the Token Service moves the tokens (an HTS allowance, HIP-719 association, and `getTokenInfo` for the router's approval: a token with a finite supply accepts no more than its maximum supply), and the Smart Contract Service runs the contract. The app reads the outcome from the mirror node.

The deploy script (`packages/hardhat/deploy/00_deploy_recurring_buy.ts`) passes the contract two things: SaucerSwap's V2 router for the network, and a reserve gas price of twice the gas price the relay reports at that moment (`eth_gasPrice`). It then writes the address and ABI to `packages/nextjs/contracts/deployedContracts.ts`, and the app starts using that contract. The Foundry script, `packages/foundry/script/DeployRecurringBuy.s.sol`, passes the same two arguments, and `scripts-js/generateTsAbis.mjs` writes the same file.

## The app

The app rebuilds a plan's history from the contract's events (`PlanCreated`, `TickScheduled`, `TickExecuted`, `TickSkipped`, `PlanStopped`, `GasDepositAdded`, `GasRefunded`) and from the mirror node's record of each schedule. That code is in `packages/nextjs/utils/recurring-buy/` and has no React in it, so its tests run on recorded mirror node responses: `yarn next:test`.

## Layout

```
packages/hardhat     RecurringBuy.sol, its mocks and tests, the deploy script
packages/foundry     the same contracts/, tests in Solidity, a forge deploy script
packages/nextjs      the app: /, /plans/new, /plans, plus the starter's Debug Contracts and block explorer
packages/saucerswap  @sh/saucerswap: SaucerSwap V2 addresses, quotes, swap paths, HTS association, WHBAR wrapping
docs                 what was measured on testnet, costs, how to check a tick
tools/gate           the template's eligibility checks
.harness             Hedera Harness recipe and validators
template.json        the manifest create-scaffold-hbar reads
```

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

Checked on testnet with this contract: a four-tick plan with a 5-minute period, the gas settlement of every tick against the fee the network charged, a skipped tick, `stop` deleting a pending schedule, the app's wrap of HBAR into WHBAR, and a tick skipped because its owner counted on an automatic association of the token bought (F2). Not yet checked on a live network: periods of hours or days, a plan that spends a finite-supply token (only simulated), a tick that fails to take its amount, a busy schedule second, a tick that runs out of gas, a browser wallet, and mainnet.
