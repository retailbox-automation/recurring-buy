# Hardhat package

The `RecurringBuy` contract, its tests and its deploy script. Commands below run from the repository root.

## Layout

- `contracts/RecurringBuy.sol`: every plan lives in this one contract. The header comment explains what happens when a tick fails and how a plan pays for its ticks.
- `contracts/interfaces/`: the three things the contract calls. `IHederaScheduleService` (HIP-1215 functions of the system contract at `0x16b`), `IHRC719` (token association) and `ISaucerSwapV2Router` (`exactInput`).
- `contracts/mocks/`: test stand-ins for the Schedule Service, an HTS token and the router.
- `test/RecurringBuy.test.ts`: the tests.
- `deploy/00_deploy_recurring_buy.ts`: the hardhat-deploy script.
- `scripts/`: deployer account helpers and `generateTsAbis.ts`, which writes `packages/nextjs/contracts/deployedContracts.ts` after a deploy.
- `hardhat.config.ts`: networks `hardhat` (a fork of testnet), `hederaTestnet` (chain id 296) and `hederaMainnet` (295).

## Test

```bash
yarn hardhat:test
```

The Schedule Service exists only on Hedera, so the tests put `MockScheduleService` at `0x16b` and play the network's part themselves: `runTick` in the fixture sends the latest scheduled call from the contract's own address, with the gas limit it was scheduled with. The mocks keep the behaviour that matters: the HTS token refuses transfers to an account that is not associated and reverts with no data when an allowance is short, the router reverts with SaucerSwap's "Too little received" below the floor, and the Schedule Service returns response codes instead of reverting.

The Hardhat network forks testnet through the hashio relay, so the tests need network access.

## Deploy to testnet or mainnet

1. Make a deployer key. It is stored encrypted in `packages/hardhat/.env`:
   ```bash
   yarn hardhat:account:generate
   ```
   To use a key you already have, run `yarn hardhat:account:import` instead. `yarn hardhat:account` shows the address.
2. Fund that address with HBAR. On testnet use the [Hedera Portal faucet](https://portal.hedera.com/faucet).
3. Deploy:
   ```bash
   yarn hardhat:deploy:testnet
   ```
   It asks for the password of the key.

The script deploys `RecurringBuy` with two constructor arguments: SaucerSwap's V2 SwapRouter for the network, and the reserve gas price, which is twice the gas price the relay reports (`eth_gasPrice`, converted from weibar to tinybar). Deployment takes about 1.66 million gas on the Hardhat network; the script sets a limit of 2.5 million.

There is no shortcut script for mainnet: run this package's `deploy` script with `--network hederaMainnet`. The mainnet router address comes from SaucerSwap's documentation and has not been exercised by us.

On `hardhat` and `localhost` the script deploys nothing, because a local chain has no Schedule Service.

## Verify the source

`yarn hardhat:verify:testnet` runs `hardhat verify --network hederaTestnet`, configured for Sourcify, which Hashscan reads. On 2026-09-24 it did not work for us: hardhat-verify 2.1.3 calls Sourcify's v1 API, and `https://sourcify.dev/server/check-all-by-addresses` answered with a 404 page ("Unexpected token '<'"). Sourcify's v2 API verified the contract we had deployed that day: `POST https://sourcify.dev/server/v2/verify/296/<address>` with the standard JSON input that hardhat-deploy keeps under `deployments/hederaTestnet/solcInputs/` returned an exact runtime match.
