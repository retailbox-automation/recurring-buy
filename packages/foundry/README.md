# Foundry package

The `RecurringBuy` contract, its tests and its deploy script, for Foundry. Commands below run from the repository root.

Use Foundry 1.7.1 (`foundryup -v v1.7.1`). With forge 1.8 and later, `forge script` against Hedera's JSON-RPC relay fails: forge sends EIP-1898 block objects, which the relay rejects ([hiero-json-rpc-relay#5826](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5826)). Compiling and the tests are not affected.

## Layout

- `contracts/`: `RecurringBuy.sol`, its interfaces and the test mocks. The Hardhat variant of this template has the same files, byte for byte.
- `test/RecurringBuy.t.sol`: the tests.
- `script/DeployRecurringBuy.s.sol`: the deploy script.
- `scripts-js/generateTsAbis.mjs`: after a deploy, writes the address and ABI to `packages/nextjs/contracts/deployedContracts.ts`.
- `lib/`: `forge-std` 1.16.2 and `openzeppelin-contracts` 5.6.1, pinned in `foundry.lock`.

## Test

```bash
yarn foundry:test
```

The Schedule Service exists only on Hedera, so the tests put `MockScheduleService` at `0x16b` and `MockTokenService` at `0x167` with `vm.etch`, and play the network's part themselves: `_runTick` sends the latest scheduled call from the contract's own address with the gas limit it was scheduled with, then takes the gas it used from the contract's balance, as Hedera bills the schedule's payer. The tests need no network.

## Deploy to testnet

1. Make a deployer key, stored as an encrypted keystore in `~/.foundry/keystores/recurring-buy-deployer`:
   ```bash
   yarn foundry:account:generate
   ```
   It asks for a password and prints the address. To use a key you already have, run `yarn foundry:account:import` instead. `yarn foundry:account` shows the address.
2. Fund that address with HBAR from the [Hedera Portal faucet](https://portal.hedera.com/faucet).
3. Deploy:
   ```bash
   yarn foundry:deploy:testnet
   ```
   It asks for the keystore password.

The script deploys `RecurringBuy` with two constructor arguments: SaucerSwap's V2 SwapRouter for the network, and the reserve gas price, which is twice the gas price the relay reports (`eth_gasPrice`, converted from weibar to tinybar). The transaction is a legacy one (`--legacy`), priced at the relay's `eth_gasPrice`. On a chain other than Hedera testnet (296) or mainnet (295) the script stops, because a local chain has no Schedule Service.

On testnet on 2026-09-30 this deployed [0.0.10796292](https://hashscan.io/testnet/contract/0.0.10796292) with 2,134,668 gas, 2.33 HBAR (run F in [docs/testnet-findings.md](../../docs/testnet-findings.md)).

For mainnet, run the same `forge script` command from `packages/foundry` with `--rpc-url hedera_mainnet`, then `node scripts-js/generateTsAbis.mjs`. The mainnet router address comes from SaucerSwap's documentation and has not been exercised by us.

## Verify the source

Sourcify, which Hashscan reads, verifies the contract with forge's own command. Run it from `packages/foundry`, with the address and the reserve gas price the deploy printed:

```bash
forge verify-contract <address> contracts/RecurringBuy.sol:RecurringBuy --chain-id 296 --verifier sourcify \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" 0x0000000000000000000000000000000000159398 <reserve gas price>)
```

It gave an exact match for the contract above.

## Format and lint

`yarn foundry:format` runs `forge fmt` and `yarn foundry:lint` runs `forge fmt --check` on `test/` and `script/`. `contracts/` keeps the prettier formatting of the Hardhat variant, so `forge fmt` leaves it alone.
