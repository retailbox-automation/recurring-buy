# What was measured on Hedera testnet

Two throwaway prototypes ran on Hedera testnet before this template was written, and then the template's own contract (run E) and its wrap step (run G). The gas figures in the README, the comments in the code and the mirror node fixtures in `packages/nextjs/utils/recurring-buy/fixtures/` come from these runs. Code comments point here by label: `A3` is finding 3 of run A, `B7` is finding 7 of run B.

The template's `RecurringBuy` is a rewrite of the contract from run B. It has more in it (many plans in one contract, a failed swap caught instead of reverting the tick, per-plan gas accounting), so its gas figures differ somewhat. Run E is the template's own contract on testnet.

Both runs used the hashio JSON-RPC relay `https://testnet.hashio.io/api` (chain id 296) and the mirror node `https://testnet.mirrornode.hedera.com/api/v1`. The gas price was 109 tinybar per gas in both.

SaucerSwap V2 on testnet, checked against SaucerSwap's contract list and by calling them:

| Contract | Hedera id | EVM address |
| --- | --- | --- |
| SwapRouter | `0.0.1414040` | `0x0000000000000000000000000000000000159398` |
| QuoterV2 | `0.0.1390002` | `0x00000000000000000000000000000000001535b2` |
| WHBAR token | `0.0.15058` | `0x0000000000000000000000000000000000003ad2` |
| WHBAR contract (`deposit()` wraps HBAR) | `0.0.15057` | |
| SAUCE token, 6 decimals | `0.0.1183558` | `0x0000000000000000000000000000000000120f46` |

The WHBAR/SAUCE pool exists only at fee 3000 (0.3%). `getPool` returned the zero address for 500, 1500 and 10000.

## Run A: a scheduled swap that a person signs (2026-09-24)

An agent schedules a swap of 1 HBAR for SAUCE on the SaucerSwap router, with a person's account ([`0.0.10702176`](https://hashscan.io/testnet/account/0.0.10702176)) as payer. The person signs the schedule from an EVM wallet key (`signSchedule()`), and the swap executes in the same second.

| Test | What | Result |
| --- | --- | --- |
| S1 | The person associates SAUCE from an EVM key: HIP-719 `associate()` sent to the token's address | [0x4bc7940e…](https://hashscan.io/testnet/transaction/0x4bc7940e89e2f5c3924536aa6584a8a910b39610a3026bf9c802b9978bcaa928). `isAssociated()` false → true. 726,488 gas, 0.7919 HBAR |
| S2 | Quote from QuoterV2, floor at 99% of it, `ScheduleCreate` of `multicall[exactInput, refundETH]` with gas limit 257,409, then `signSchedule()` | schedule [0.0.10702191](https://hashscan.io/testnet/schedule/0.0.10702191), executed at [1790274504.474310540](https://hashscan.io/testnet/transaction/1790274504.474310540): SUCCESS, 46.336444 SAUCE received (floor 45.873079) |
| S3 | The same with the floor at 150% of the quote | schedule [0.0.10702194](https://hashscan.io/testnet/schedule/0.0.10702194), executed at [1790274529.452797957](https://hashscan.io/testnet/transaction/1790274529.452797957): `CONTRACT_REVERT_EXECUTED`, `Error("Too little received")`. No SAUCE moved and the 1 HBAR stayed with the person |
| S4 | A schedule that expires after 75 s and is never signed | schedule [0.0.10702201](https://hashscan.io/testnet/schedule/0.0.10702201): not executed. A signature sent after expiry did nothing |
| S5 | The same swap scheduled from a contract through HIP-1215 `executeCallOnPayerSignature` | schedule [0.0.10702239](https://hashscan.io/testnet/schedule/0.0.10702239), executed at [1790274808.938536106](https://hashscan.io/testnet/transaction/1790274808.938536106): SUCCESS, 46.331214 SAUCE received |

Findings:

- **A1.** HIP-719 `associate()` from an EVM key works and costs as much as a native association: 726,488 gas, 0.7919 HBAR. Without it a swap to that account fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.
- **A2.** A scheduled contract call can carry HBAR. The value is taken from the payer when the call executes, in one transfer with the gas.
- **A3.** A scheduled call signed by its payer was charged its whole gas limit when it succeeded (257,409 × 109 tinybar in S2 and S5, with 200,054 and 200,042 gas used) and only the gas used when it reverted (199,163 × 109 in S3). Compare B4: a call a contract schedules for itself was charged the gas used in both cases.
- **A4.** The wallet reports success for a signature whose swap reverted. `signSchedule()` returned 22 and EVM status 1 in S3. The revert is visible only in the record of the scheduled call. An app has to read that record and cannot rely on the wallet's receipt.
- **A5.** `eth_call` and `eth_estimateGas` through hashio, sent as the person with the value in weibar, predict the outcome: the same amount out for S2, the same revert reason for S3.
- **A6.** QuoterV2's `gasEstimate` is not a gas limit. It returned 92,234 for a swap that used 200,054: it leaves out the HTS transfers. Take the limit from `eth_estimateGas` on the router call.
- **A7.** The mirror node never shows that a schedule expired. After expiry the consensus node answers `INVALID_SCHEDULE_ID`, while the mirror node keeps returning `deleted: false` and `executed_timestamp: null`, the same as for a pending schedule. An app has to compute "missed" from the clock.
- **A8.** A signature sent to an expired schedule succeeds and does nothing: EVM status 1, 21,160 gas, no child transaction. `eth_estimateGas` for it looks the same as for a live schedule.
- **A9.** The mirror node leaves a call scheduled through HIP-1215 out of `/contracts/results` lists unless `internal=true` is passed.
- **A10.** The `from` the mirror node shows for a HIP-1215 scheduled call is `0.0.7314364`, the hashio relay's account. The real `msg.sender` is the payer.
- **A11.** `/schedules/{id}.signatures` does not list a signature made from an EVM key.
- **A12.** The schedule's `transaction_body` on the mirror node decodes to the router call, so an app can show a person what a scheduled swap will do before they sign: pair, amount, floor, recipient and deadline.
- **A13.** An SDK-made schedule carries a maximum fee of 2 HBAR for the inner transaction by default. A HIP-1215 schedule carries 0 and still executes.
- **A14.** The router deadline was set to the schedule's expiry second.
- **A15.** In `@hiero-ledger/sdk` 2.88.0 `ContractId`, `TokenId` and `AccountId` have `toEvmAddress()` only, and `ScheduleId` has `toSolidityAddress()` only.
- **A16.** Costs at 109 tinybar per gas: `signSchedule()` 0.1778 HBAR; the scheduled swap 0.2806 HBAR when it succeeds and 0.2171 HBAR when it reverts; a HIP-1215 schedule created from a contract 1,443,888 gas, 1.5738 HBAR.

## Run B: a contract that buys on a schedule it sets for itself (2026-09-29)

The prototype of this template: [RecurringBuy 0.0.10777783](https://hashscan.io/testnet/contract/0.0.10777783). A user account, [`0.0.10777774`](https://hashscan.io/testnet/account/0.0.10777774), wraps HBAR, approves the contract for 0.1 WHBAR and starts a plan of two buys of 0.05 WHBAR, 90 s apart, with the floor at 95% of the quote (1.943793 SAUCE).

| Step | Result |
| --- | --- |
| Deploy | 1,265,670 gas, 1.3796 HBAR, for 6,029 bytes of init code |
| The contract associates itself with WHBAR and approves the router | associate 710,965 gas, approve 705,999 gas; 1,440,373 gas and 1.5700 HBAR for the transaction |
| The user wraps HBAR: `deposit()` on the WHBAR contract, with automatic association | 771,256 gas, 0.8407 HBAR |
| The user associates SAUCE | 726,488 gas, 0.7919 HBAR |
| The user approves the contract on WHBAR | 727,020 gas, 0.7925 HBAR |
| `start()` schedules tick 1: `scheduleCall(this, now + 90, 1,903,955 gas, 0, tick())` | schedule [0.0.10777792](https://hashscan.io/testnet/schedule/0.0.10777792), response code 22. 1,643,976 gas, 1.7919 HBAR, paid by the user |
| The network runs tick 1 | [1790691317.164542146](https://hashscan.io/testnet/transaction/1790691317.164542146): SUCCESS, 0.165 s after the expiry second. The user's WHBAR went from 0.12 to 0.07 and SAUCE from 0 to 2.046098. The user's HBAR did not change. 1,622,904 gas, 1.7690 HBAR, paid by the contract |
| Tick 1 schedules tick 2 | schedule [0.0.10777807](https://hashscan.io/testnet/schedule/0.0.10777807), payer the contract, gas limit 237,210 |
| The network runs tick 2, the last one | [1790691406.039763456](https://hashscan.io/testnet/transaction/1790691406.039763456): SUCCESS, 0.040 s after expiry. WHBAR 0.07 → 0.02, SAUCE → 4.092182. 178,643 gas, 0.1947 HBAR. The allowance is down to 0 |
| Negative control: a new one-tick plan while the allowance is 0 | schedule [0.0.10777841](https://hashscan.io/testnet/schedule/0.0.10777841), tick at [1790691529.110199928](https://hashscan.io/testnet/transaction/1790691529.110199928): `CONTRACT_REVERT_EXECUTED` with empty revert data. Nothing was taken. 72,669 gas, 0.0792 HBAR |

Before their expiry second neither tick had executed: `executed_timestamp` was null and the user's balances were unchanged. They changed only once the schedule showed an execution.

Findings:

- **B1.** A call scheduled with `scheduleCall`, with the contract as payer, can itself call `scheduleCall(this, …)` and get response code 22. The network ran both ticks with no outside trigger.
- **B2.** Inside a tick `msg.sender` is the contract itself: its own EVM address, not a long-zero form. The mirror node's `from` for the same call is the hashio relay's account, which is wrong. So the guard for a tick is `msg.sender == address(this)`.
- **B3.** Inside a tick `block.timestamp` was one or two seconds before the expiry second: 1790691316 for expiry 1790691317, and 1790691404 for expiry 1790691406. A guard `block.timestamp >= expiry` would have reverted both ticks. It also means that a next expiry computed as `block.timestamp + period` lands a second or two earlier with every tick.
- **B4.** A tick was charged its gas used at 109 tinybar, not its gas limit: 1,622,904 × 109 for tick 1 (limit 1,903,955), 178,643 × 109 for tick 2 (limit 237,210), 72,669 × 109 for the reverted one. Compare A3.
- **B5.** Where a tick's gas goes:

  | Part | Gas | HBAR at 109 tinybar |
  | --- | --- | --- |
  | `transferFrom` under the allowance | 20,892 | 0.0228 |
  | `exactInput` WHBAR → SAUCE, with the pool's HTS transfers | 112,690 | 0.1228 |
  | `scheduleCall` for the next tick | 1,410,574 | 1.5375 |
  | the rest: intrinsic gas, storage, events, `hasScheduleCapacity` | 78,748 | 0.0858 |
  | **a tick that buys and schedules the next one** | **1,622,904** | **1.7690** |
  | **the last tick** | **178,643** | **0.1947** |

  Scheduling the next tick is 87% of a tick's cost. The amount swapped does not change it. At the testnet exchange rate of that day, 7.7 cents per HBAR, a tick cost about $0.136 and the last one about $0.015.
- **B6.** The mirror node does not find a chain's schedules by account. The creator of tick 1's schedule is the user who sent `start()`, the creator of tick 2's is the hashio relay, and the payer of both is the contract. `/schedules?account.id=` for the contract returns nothing. Follow the chain through the contract's events.
- **B7.** A tick inherits the transaction id and the nonce of the call that created its schedule. `/contracts/results/{transactionId}?nonce=N` can therefore return the scheduling call instead of the tick: it did for the negative control. Read a tick by the schedule's `executed_timestamp`: `/contracts/{contractId}/results/{timestamp}`.
- **B8.** `eth_estimateGas` works for a call that ends in `scheduleCall`: 1,676,323 estimated against 1,622,904 used.
- **B9.** A tick that reverts as a whole kills the chain, and the contract cannot see it. The revert also undoes the tick's own bookkeeping, so the plan stays `active` with nothing scheduled. The HTS facade reverts with no data when the allowance is short, so there is no reason to read either. This is why the template runs the pull and the swap in a self-call under `try`/`catch`, and why the app takes a plan's status from the last schedule's execution.
- **B10.** Once an allowance is used up, `/accounts/{id}/allowances/tokens` returns an empty list for it and `allowance()` returns 0.
- **B11.** A contract deployed through the relay gets unlimited automatic token associations (`max_automatic_token_associations = -1`).
- **B12.** Deploying cost 1.38 HBAR, which is why the template keeps every plan in one contract instead of deploying one per user.

Not tested in run B: a second `scheduleCall` in one scheduled execution (response code 373, `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`), `try`/`catch` around the swap in a live tick, `deleteSchedule`, `hasScheduleCapacity` returning false, periods longer than 90 s, plans longer than two ticks, a browser wallet, mainnet.

## Simulations (2026-09-30)

Read-only calls to the mirror node's `/api/v1/contracts/call`, which runs a call against current testnet state without sending a transaction.

- **D1.** An HTS token with a finite supply refuses an allowance above its maximum supply. `approve(SwapRouter, 2^63 - 1)` on SAUCE (supply type `FINITE`, maximum supply 1,000,000,000,000,000 in its smallest unit), sent from an account associated with SAUCE, reverted with `AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY`. The same call for exactly the maximum supply returned true, and for the maximum supply plus one it reverted again. On WHBAR (supply type `INFINITE`) the call with `2^63 - 1` returned true. So `RecurringBuy` approves the router for a finite-supply token's maximum supply, which it reads with the Token Service's `getTokenInfo` (`0x167`), and for `2^63 - 1` otherwise. A simulated contract creation that does the same steps (associate, `getTokenInfo`, approve, then approve one unit more) returned, for SAUCE: response code 22, supply type finite, maximum supply 1,000,000,000,000,000, true for the approval of that amount, and a revert for one unit more. For WHBAR: response code 22, supply type infinite, maximum supply 0, true for `2^63 - 1`. `getTokenInfo` took 21,108 gas for either token, and the full `TokenInfo` struct decoded as declared in `contracts/interfaces/IHederaTokenService.sol`. Once deployed, the contract's own `start()` for a plan that spends SAUCE, simulated the same way, returned a plan id (run E).

- **D2.** Wrapping HBAR needs an association with WHBAR, or a free automatic association. A simulated `deposit()` with 0.1 HBAR, on SaucerSwap's WhbarHelper `0.0.5286055` and on the WHBAR contract `0.0.15057`: from `0.0.10796188`, which has no automatic association slots and is not associated with WHBAR, both reverted with `Safe token transfer failed!` and `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; from `0.0.10012993`, which has unlimited automatic associations and is not associated with WHBAR, both succeeded, estimated at 859,428 gas (helper) and 848,052 (contract); from the associated owner of run E, 85,473 and 69,609. SaucerSwap's docs ask for WHBAR to be associated before `deposit` and for integrations to wrap through WhbarHelper, not through the WHBAR contract ([docs.saucerswap.finance/developers/whbar/wrap-hbar-for-whbar](https://docs.saucerswap.finance/developers/whbar/wrap-hbar-for-whbar)). The testnet helper's storage holds the WHBAR contract `0.0.15057` (slot 0) and the WHBAR token `0.0.15058` (slot 1). A `deposit()` of zero on the WHBAR contract reverts with `Sent zero hbar to this contract`.
- **D3.** An automatic association during a swap adds about 760,000 gas, more than a tick leaves for its swap. A simulated SaucerSwap `multicall[exactInput, refundETH]` of 0.05 HBAR to SAUCE was estimated at 196,566 gas with an account associated with SAUCE as recipient, and at 956,768 with `0.0.10012993` or `0.0.9386584`, which have unlimited automatic associations and are not associated with SAUCE. `tick` gives `buy` its gas minus `RESCHEDULE_GAS` (1,600,000), less than 300,000 of the app's 1,900,000 tick gas limit, and run E's pull and swap fit in it. So a plan whose owner counts on an automatic association of the token it buys skips its ticks; the app asks for an explicit association instead. A tick of another deployment of this contract showed it live on 2026-09-30 ([0.0.10796292](https://hashscan.io/testnet/contract/0.0.10796292), owner `0.0.10012993`, tick [1790794091.124190452](https://hashscan.io/testnet/transaction/1790794091.124190452)): `buy` got 267,711 gas; the pool's SAUCE transfer to the owner through the Token Service used all 173,036 gas it was given and failed with `INSUFFICIENT_GAS`; the pool reverted with error `0xace7dae0` and code 21, and the tick ended as `TickSkipped` with nothing bought (the mirror node's `/contracts/results/<hash>/actions`). A plain WHBAR `transfer` to `0.0.10012993` was estimated at the same 39,761 gas as one to an associated account, so the extra gas shows on the router's and WHBAR's paths but not on every transfer; the live wraps agree with the simulations (771,256 gas with an automatic association in run E, 77,966 without in G1).

## Run E: this template's contract (2026-09-30)

`RecurringBuy` as it is in this repository, deployed to testnet by the account [`0.0.9386584`](https://hashscan.io/testnet/account/0.0.9386584) through hashio: [0.0.10795675](https://hashscan.io/testnet/contract/0.0.10795675) (`0x24d06cfba7265a93c5a20743135f01f29c49da17`).

| Step | Result |
| --- | --- |
| Deploy, gas limit 3,000,000 | [1790790375.672707104](https://hashscan.io/testnet/transaction/1790790375.672707104): SUCCESS. 2,176,533 gas (`eth_estimateGas` said 2,376,899, the Hardhat network 2,176,737), 2.3724 HBAR. Constructor arguments: router `0.0.1414040`, reserve gas price 228 tinybar |
| Source verification through Sourcify's v2 API | exact match of the creation and the runtime code: [sourcify.dev/server/v2/contract/296/0x24d06Cfba7265A93c5A20743135F01f29C49DA17](https://sourcify.dev/server/v2/contract/296/0x24d06Cfba7265A93c5A20743135F01f29C49DA17) (match 54436423) |
| Simulated `start()` of a plan that spends SAUCE, through the mirror node's `/contracts/call` | returned plan id 1: the contract associated itself with SAUCE, read its maximum supply and approved the router for it (D1). 3,280,633 gas estimated. With a deposit one tinybar short the same call reverted with `InsufficientGasDeposit(433200000)` |

Then an owner did what `/plans/new` asks, with the same parameters, gas limits (`eth_estimateGas` × 1.2) and gas price (`eth_gasPrice`) as the app. The owner is a new ECDSA account, [`0.0.10795743`](https://hashscan.io/testnet/account/0.0.10795743) (`0x7b7bbdaa473d3f741ae1c6466bd46e6f574dc9b8`), created with one automatic token association.

| Step | Result |
| --- | --- |
| Wrap 0.25 HBAR: `deposit()` on the WHBAR contract `0.0.15057` | [1790790783.572533601](https://hashscan.io/testnet/transaction/1790790783.572533601): 771,256 gas, 0.8407 HBAR. WHBAR took the automatic association |
| Associate SAUCE (HIP-719) | [1790790790.052318809](https://hashscan.io/testnet/transaction/1790790790.052318809): 726,488 gas, 0.7919 HBAR |
| Approve the contract for 0.30 WHBAR, enough for plans 1 and 2 | [1790790797.352588315](https://hashscan.io/testnet/transaction/1790790797.352588315): 727,032 gas, 0.7925 HBAR |
| Plan 1: 0.05 WHBAR → SAUCE every 300 s, 4 buys, floor 1.942421 SAUCE (95% of the quote of 2.044654), tick gas limit 1,900,000, deposit 4 × 4.332 = 17.328 HBAR | [`start`](https://hashscan.io/testnet/transaction/1790790834.555078365): SUCCESS, 3,114,516 gas, 3.3948 HBAR. The first plan on WHBAR, so the contract also associated itself with WHBAR, read its supply and approved the router. Tick 1: schedule [0.0.10795766](https://hashscan.io/testnet/schedule/0.0.10795766) |
| Tick 1 | [1790791132.086448208](https://hashscan.io/testnet/transaction/1790791132.086448208): SUCCESS. Bought 2.044654 SAUCE, scheduled tick 2 ([0.0.10795812](https://hashscan.io/testnet/schedule/0.0.10795812)). 1,605,224 gas, 1.7497 HBAR, paid by the contract |
| Tick 2 | [1790791430.054047190](https://hashscan.io/testnet/transaction/1790791430.054047190): SUCCESS. Bought 2.044640 SAUCE, scheduled tick 3 ([0.0.10795861](https://hashscan.io/testnet/schedule/0.0.10795861)). 1,605,224 gas, 1.7497 HBAR |
| Tick 3 | [1790791728.078691208](https://hashscan.io/testnet/transaction/1790791728.078691208): SUCCESS. Bought 2.044626 SAUCE, scheduled tick 4 ([0.0.10795909](https://hashscan.io/testnet/schedule/0.0.10795909)). 1,605,224 gas, 1.7497 HBAR |
| Tick 4, the last | [1790792026.001025208](https://hashscan.io/testnet/transaction/1790792026.001025208): SUCCESS. Bought 2.044612 SAUCE, `PlanStopped(Completed)`. 182,352 gas, 0.1988 HBAR. The owner now held 8.178532 SAUCE and 0.05 WHBAR |
| Withdraw: `stop` on the completed plan | [1790792048.020794657](https://hashscan.io/testnet/transaction/1790792048.020794657): `GasRefunded` 11.71088556 HBAR. 35,957 gas, 0.0392 HBAR |
| Plan 2: the same pair, 2 buys, floor 3.066897 SAUCE (150% of the quote), deposit 8.664 HBAR | [`start`](https://hashscan.io/testnet/transaction/1790792073.558088511): SUCCESS, 1,637,955 gas, 1.7854 HBAR. Tick 1: schedule [0.0.10795970](https://hashscan.io/testnet/schedule/0.0.10795970) |
| Plan 2, tick 1 | [1790792373.084332104](https://hashscan.io/testnet/transaction/1790792373.084332104): SUCCESS with `TickSkipped` (reason `Error("Too little received")`) and `TickScheduled` for tick 2 ([0.0.10796029](https://hashscan.io/testnet/schedule/0.0.10796029)). The owner's WHBAR stayed at 0.05. 1,610,623 gas, 1.7556 HBAR |
| `stop` of plan 2 with tick 2 pending | [1790792387.304319777](https://hashscan.io/testnet/transaction/1790792387.304319777): `PlanStopped(StoppedByOwner)` with `deleteSchedule` response 22, `GasRefunded` 6.86555886 HBAR: the deposit left, 2.53355886, plus tick 2's reservation, 4.332. 118,556 gas, 0.1292 HBAR |

Findings:

- **E1.** The network charged 109 tinybar per gas while hashio's `eth_gasPrice` returned 114 (1,140,000,000,000 weibar), and the mirror node records `gas_price` 114 for the transaction. The deployer paid 237,242,097 tinybar, which is 2,176,533 × 109 to the tinybar: the gas used, not the limit.
- **E2.** Inside a scheduled tick `tx.gasprice` is the price the network bills. Every `TickCharged` of the five ticks reported 109, and every tick's fee was its gas used times 109 to the tinybar (174,969,416 = 1,605,224 × 109). The mirror node records `gas_price` 109 for the ticks. The reserve price of 228 is therefore 2.09 times what a tick costs per gas.
- **E3.** `SETTLEMENT_GAS` (40,000) covers what a tick does after it measures itself: every tick charged its plan more gas than the network billed, 39,323 more for a tick that scheduled the next one (bought or skipped) and 37,323 for the last tick. That is 0.043 and 0.041 HBAR per tick, which stays in the contract and belongs to no plan: after the five ticks the contract held 0.21213035 HBAR, exactly that surplus.
- **E4.** Gas of this contract on testnet: a tick that buys and schedules the next one 1,605,224 (the prototype's 1,622,904); a skipped tick 1,610,623; the last tick 182,352; `start` 1,637,955, plus 1,476,561 once for the first plan on a spend token (associate, `getTokenInfo`, approve); `stop` with a pending tick 118,556; a withdrawal 35,957; the deployment 2,176,533. At 109 tinybar: 1.750, 1.756, 0.199, 1.785 (+1.609), 0.129, 0.039 and 2.372 HBAR.
- **E5.** A plan pays for its own ticks. Plan 1 paid 17.328 HBAR in, was charged 5.61711444 for its four ticks (the network billed the contract 5.44784616) and got 11.71088556 back. Plan 2 paid 8.664, was charged 1.79844114 for its one tick and got 6.86555886 back at `stop`.
- **E6.** The network ran every tick 0.001 to 0.086 s after its expiry second. Inside each tick `block.timestamp` was 2 s before that second (B3), so each next expiry came 298 s after the previous one with a period of 300.
- **E7.** Each tick's fee was taken from the contract's account (`/transactions?timestamp=`); the owner's HBAR did not move during ticks. All four ticks of plan 1 carry the transaction id of the plan's `start` call, `0.0.7314364-1790790827-043183925` (the hashio relay's account), with nonces 53, 107, 161 and 215 (B6, B7): the id cannot tell the ticks of a plan apart, the timestamp can.
- **E8.** `deleteSchedule` on the pending tick returned 22. From then on the mirror node shows schedule `0.0.10796029` with `deleted: true`, and 33 s after its expiry second it still had no `executed_timestamp` and the contract had no result after 1790792660. The same query for the window of plan 2's tick 1 returns that tick.

## Run G: wrapping HBAR from /plans/new (2026-09-30)

The owner of run E, [`0.0.10795743`](https://hashscan.io/testnet/account/0.0.10795743), already associated with WHBAR, sent the transaction that the "Get WHBAR" step of `/plans/new` builds (`buildWrapHbar` in `@sh/saucerswap`: `deposit()` on SaucerSwap's WhbarHelper `0.0.5286055` with the HBAR attached), with the app's gas limit (`eth_estimateGas` × 1.2) and fee fields (`eth_gasPrice`, no priority fee).

| Step | Result |
| --- | --- |
| Wrap 0.1 HBAR | [1790794391.315370441](https://hashscan.io/testnet/transaction/1790794391.315370441): SUCCESS. 77,966 gas (estimated 85,252, limit 102,302), a fee of 8,498,294 tinybar, which is 77,966 × 109. The owner's HBAR went from 1.05954444 to 0.87456150 (0.1 wrapped and 0.08498294 of fee), its WHBAR from 0.05 to 0.15 |

- **G1.** A wrap into an account already associated with WHBAR used 77,966 gas, 0.085 HBAR, a tenth of the 771,256 gas of run E's wrap, which also took an automatic association. Associating first (726,488 gas) and then wrapping costs about as much as a wrap with an automatic association, and it is what SaucerSwap asks for (D2).

## Relay and tooling

- **C1.** hashio's block header reports a `baseFeePerGas` of 109, far below the gas price the relay accepts. A client that derives its fees from the header sends a price the relay rejects with "Gas price … is below configured minimum". Read `eth_gasPrice` and send that.
- **C2.** Source verification with hardhat-verify 2.1.3 failed on 2026-09-24: it calls Sourcify's v1 API, which answered 404. Sourcify's v2 API (`POST /server/v2/verify/296/<address>` with the standard JSON input) verified the contract. On 2026-09-30 the same call verified this template's contract (run E), with the standard JSON input from `deployments/hederaTestnet/solcInputs/`, compiler `0.8.28+commit.7893614a`, contract `contracts/RecurringBuy.sol:RecurringBuy` and the deploy transaction's hash; the job finished in 5 s.
- **C3.** A contract deployed through the relay gets itself as its admin key. Hashscan shows an admin key on a contract that nobody administers.
- **C4.** The relay's `eth_gasPrice` is the mirror node's price for an `EthereumTransaction` plus the relay operator's margin: `getGasPriceInWeibars` in the relay reads `/api/v1/network/fees`, and `addPercentageBufferToGasPrice` adds `GAS_PRICE_PERCENTAGE_BUFFER` (default 0; source: hiero-ledger/hiero-json-rpc-relay, `src/relay/lib/services/ethService/ethCommonService/CommonService.ts` and `src/relay/utils.ts`). On 2026-09-30 `/network/fees` on testnet gave 109 tinybar per gas for `ContractCall`, `ContractCreate` and `EthereumTransaction`, the price the network charged in run E (E1, E2), while hashio's `eth_gasPrice` gave 114. So the app prices transactions and ticks with `/network/fees` and sends transactions with `eth_gasPrice`.
