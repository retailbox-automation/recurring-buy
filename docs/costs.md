# What a plan costs

All gas figures are from this template's contract on Hedera testnet on 2026-09-30, at 109 tinybar per gas: runs E, F and G in [testnet-findings.md](testnet-findings.md).

## The transactions you sign

| # | Transaction | What it allows | Gas on testnet |
| --- | --- | --- | --- |
| 1 | Associate your account with the token you buy (HIP-719) | Lets you receive that token | 726,488 gas, 0.79 HBAR |
| 2 | Associate your account with WHBAR, when you spend WHBAR and need to wrap some | Lets you hold WHBAR | 726,488 gas, 0.79 HBAR |
| 3 | Wrap HBAR into WHBAR through SaucerSwap's WhbarHelper, as much as the plan is short of | Turns HBAR into WHBAR one to one | 77,966 gas, 0.085 HBAR, plus the HBAR you wrap |
| 4 | Approve the contract on the token you spend | The contract may take up to the plan's total, one buy at a time. Plans of one owner on the same token share this allowance | 727,032 gas, 0.79 HBAR |
| 5 | Start the plan, with the gas deposit attached | Creates the plan and schedules its first tick | 1,637,955 gas, 1.79 HBAR, plus the deposit |

The first four are skipped when they are already done. The token you buy is associated even if your account associates tokens automatically: an automatic association inside a tick's swap adds about 760,000 gas, more than a tick leaves for its swap (D3). WHBAR is associated before a wrap because SaucerSwap asks for it, and a wrap into an associated account used 77,966 gas against 771,256 for one that took an automatic association (D2, G1).

The first plan on a contract for a given spend token costs more to start: the contract associates itself with that token, reads the token's supply from the Token Service and approves SaucerSwap's router for as much as the token allows, 1,476,561 gas (1.61 HBAR) more, once.

## Which gas price

`/plans/new` prices every transaction and tick at the gas price the network bills, which the mirror node publishes at `/api/v1/network/fees`: 109 tinybar per gas on testnet on 2026-09-30, for both `ContractCall` (a scheduled tick) and `EthereumTransaction` (what a wallet sends). The relay's `eth_gasPrice`, which the app sends as the maximum fee, is that price plus the relay operator's margin: hashio reported 114 on the same day (C4). The app also sets each gas limit to the transaction's `eth_estimateGas` plus 20%. So a wallet shows a maximum fee of the gas limit at the relay's price, while the network charges the gas used at its own (E1, G1).

## The gas deposit

After the start transaction nobody signs anything. Ticks are paid from the plan's gas deposit:

- Scheduling a tick reserves `tickGasLimit × reserveGasPrice` from the deposit. The app uses a gas limit of 1,900,000. The reserve price is fixed at deployment: the deploy script passes the contract twice the gas price the relay reports at that moment (`eth_gasPrice`). On 2026-09-30 hashio reported 114 tinybar per gas on testnet (the network charged 109), which gives 228 tinybar and 1,900,000 × 228 tinybar = 4.332 HBAR per tick.
- When the tick runs, the contract measures the gas it used, charges the plan for it at the network's gas price, and puts the rest of the reservation back into the deposit. The measurement adds a fixed 40,000 gas for the bookkeeping that follows it.
- A tick that bought and scheduled the next one used 1,605,224 gas, 1.750 HBAR. The last tick of a plan, which schedules nothing, used 182,352 gas, 0.199 HBAR. A skipped tick costs about as much as a buying one: 1,610,623 gas.
- The contract charged each tick at the price the network billed it (109 tinybar per gas on testnet), for 37,323 to 39,323 gas more than the network counted (E3): the allowance for the settlement is a little generous, and the difference, about 0.04 HBAR per tick, stays in the contract.
- The app asks for one full reservation per buy. For four buys that is 17.328 HBAR up front. The reference plan was charged 5.617 HBAR of it for its four ticks and got 11.711 HBAR back when its owner withdrew.

Scheduling the next tick is most of a tick's gas (a tick that schedules nothing used 182,352 of the 1,605,224), and the amount you buy does not change it. A buy therefore costs about 1.75 HBAR in gas whatever its size, and small, frequent buys are poor value.

## Deploying

Deploying the contract used 2,176,533 gas, 2.37 HBAR, on testnet with Hardhat (E4), and 2,134,668 gas, 2.33 HBAR, with Foundry (F1).
