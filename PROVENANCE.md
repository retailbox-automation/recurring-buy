# Provenance

This template starts from the official scaffold-hbar blank starter. This file separates the starter code from the work added on top of it.

## Starter (upstream, MIT)

- Generated on 2026-09-24 with create-scaffold-hbar 0.4.0 (package `create-scaffold-hbar@0.4.0` on npm; source `hedera-dev/create-scaffold-hbar`, tag `v0.4.0`, commit `5732f5e`):

  ```bash
  npm create scaffold-hbar@latest template -- --template blank -s hardhat --package-manager yarn --ci --skip-hedera-skills
  ```

- Template source: `buidler-labs/scaffold-hbar`, branch `templates/blank-template`, commit `88c8837f451c925476b8250e1281c257022b9bbc` (2026-08-24).
- In this repository the starter is commit `90148ef` ("Initial commit with create-scaffold-hbar @ 0.4.0"). Everything in that commit is upstream work: Copyright (c) 2023 BuidlGuidl, Copyright (c) 2026 hedera-dev, MIT (see `LICENSE`).

## Our work

Every commit after `90148ef` (`git log 90148ef..`), all made inside the bounty build window (21.09–04.10.2026).

Changed in starter files:

- `LICENCE` renamed to `LICENSE`, with our copyright line added below the upstream ones.
- `.gitmodules`: the starter listed four Foundry submodules; it now lists the two the Foundry variant pins, `forge-std` and `openzeppelin-contracts`.
- `.gitignore`: env files and Hedera Harness runtime directories.
- `README.md`, `AGENTS.md`, `CLAUDE.md` and `packages/hardhat/README.md` rewritten.
- The starter's sample contracts removed with their deploy scripts and tests: `HederaToken.sol`, `HtsTokenCreator.sol`, `interfaces/IHederaTokenService.sol`. `packages/nextjs/contracts/deployedContracts.ts` no longer lists their testnet deployments.
- `packages/hardhat/hardhat.config.ts`: the Sourcify comment points to the v2 request that verified the contract, since `hardhat-verify` 2.1.3 got a 404.
- `packages/hardhat/scripts/generateTsAbis.ts`: a deploy that deploys nothing (any network without the Hedera Schedule Service) ends cleanly instead of throwing.
- `packages/nextjs`: the home page replaced; `Header.tsx` names the app and links its pages; `Footer.tsx` keeps the price, faucet and theme controls in the page flow instead of fixed over the content; `scaffold.config.ts` gains `referencePlan`; the burner wallet exists only in a build made with `NEXT_PUBLIC_ENABLE_BURNER_WALLET=true`.
- Root `package.json`: `gate:*`, `harness:run`, `hardhat:deploy:testnet` and `foundry:*` scripts; `hedera-harness` and `zod` dev dependencies; a third workspace package and its `saucerswap:*` scripts (see Added).
- `packages/nextjs/next.config.ts`: the optional `@x402/*` imports of `@coinbase/cdp-sdk` resolve to empty modules, so `next build` passes in npm-based scaffolds (the upstream blank starter fails it on npm).

Added:

- `template.json` (manifest for create-scaffold-hbar).
- `tools/gate/` (eligibility gate scripts and their tests).
- `.github/workflows/gate.yml` (the same gate in CI).
- `.gitleaks.toml` (gitleaks defaults, minus Yarn's vendored release and plugins).
- `.harness/` (Hedera Harness v3 recipe and validators).
- `packages/saucerswap/` (`@sh/saucerswap`): the SaucerSwap V2 code the app uses, with no React in it: addresses, the quote and the price floor, HTS association, wrapping HBAR into WHBAR.
- `packages/hardhat/contracts/RecurringBuy.sol`, the interfaces and mocks next to it, `test/RecurringBuy.test.ts` and `deploy/00_deploy_recurring_buy.ts`.
- `packages/foundry/`: the Foundry variant. `contracts/` is a copy of `packages/hardhat/contracts`; `test/RecurringBuy.t.sol`, `script/DeployRecurringBuy.s.sol` and `scripts-js/generateTsAbis.mjs` are new. The package's layout follows the starter's Foundry package (`buidler-labs/scaffold-hbar`, `templates/blank-template`), which was not part of our Hardhat scaffold. `lib/` holds git submodules, not copies: forge-std (MIT or Apache-2.0) and OpenZeppelin Contracts (MIT), at the tags in `foundry.lock`.
- `packages/nextjs`: routes `/plans/new` and `/plans`, `components/recurring-buy/`, `hooks/recurring-buy/` and `utils/recurring-buy/` with its tests and mirror node fixtures.
- `docs/testnet-findings.md`: what was measured on Hedera testnet: our two prototype runs (A and B, 2026-09-24 and 2026-09-29), then read-only simulations (D) and runs of the template's own contract (E), its Foundry variant (F) and its wrap step (G) on 2026-09-30. The prototypes themselves are not in this repository; `RecurringBuy.sol` was written anew from what they showed.
- `docs/costs.md`, `docs/how-it-works.md`, `docs/verify-ticks.md` and `docs/checks.md`: what a plan costs, how the template works and its known limitations, how to check a tick, and the template's checks.

Third-party code inside our files:

- `tools/gate/validate-template-json.mjs` contains a copy of the `template.json` zod schema from create-scaffold-hbar 0.4.0 `src/types.ts` (MIT, hedera-dev), so the gate validates the manifest exactly as the CLI parses it.
- `packages/hardhat/contracts/interfaces/IHederaTokenService.sol` declares only `getTokenInfo`, with its result structs laid out field for field as in Hedera's `IHederaTokenService.sol` (`hashgraph/hedera-smart-contracts`, Apache-2.0): the result decodes only if the layout matches. It is not the starter's file of the same name, which was removed.
