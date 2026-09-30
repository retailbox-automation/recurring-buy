# Check that a tick really ran

The wallet only confirms that the plan was created. A tick is a separate transaction that the network starts, so check it on the network:

1. Each `TickScheduled` event of the contract carries the schedule's address. As a Hedera id it opens on Hashscan: `https://hashscan.io/testnet/schedule/0.0.<N>`. The app links it next to every tick.
2. The mirror node's `/api/v1/schedules/0.0.<N>` shows `executed_timestamp` once the network has run it.
3. `/api/v1/contracts/<contract id>/results/<executed_timestamp>` is the tick itself: `SUCCESS` or `CONTRACT_REVERT_EXECUTED`, with the gas used. On Hashscan: `https://hashscan.io/testnet/transaction/<executed_timestamp>`.
4. `/api/v1/transactions?timestamp=<executed_timestamp>` shows who paid: the transfer out of the contract's account is the tick's fee.

Read a tick by its timestamp, as above. The mirror node's `/contracts/results/<transaction id>?nonce=<n>` can return the call that scheduled the tick instead of the tick (finding B7 in [testnet-findings.md](testnet-findings.md)). For the same reason the app takes a plan's status from the execution of its last schedule, not from the contract's `active` flag.
