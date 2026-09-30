# Provenance

This template starts from the official scaffold-hbar blank starter. This file separates the starter code from the work added on top of it.

## Starter (upstream, MIT)

- Generated on 2026-09-24 with create-scaffold-hbar 0.4.0 (npm package `create-scaffold-hbar@0.4.0`; source `hedera-dev/create-scaffold-hbar`, tag `v0.4.0`, commit `5732f5e`):

  ```bash
  npm create scaffold-hbar@latest template -- --template blank -s hardhat --package-manager yarn --ci --skip-hedera-skills
  ```

- Template source: `buidler-labs/scaffold-hbar`, branch `templates/blank-template`, commit `88c8837f451c925476b8250e1281c257022b9bbc` (2026-08-24).
- In this repository the starter is commit `90148ef` ("Initial commit with create-scaffold-hbar @ 0.4.0"). Everything in that commit is upstream work: Copyright (c) 2023 BuidlGuidl, Copyright (c) 2026 hedera-dev, MIT (see `LICENSE`).

## Our work

Every commit after `90148ef` (`git log 90148ef..`), all made inside the bounty build window (21.09–04.10.2026).

Changed in starter files:

- `LICENCE` renamed to `LICENSE`, with our copyright line added below the upstream ones.
- `.gitmodules` removed: it listed Foundry submodules, and this template is Hardhat-only.
- `.gitignore`: env files and Hedera Harness runtime directories.
- `README.md`, `AGENTS.md`, `CLAUDE.md` and `packages/hardhat/README.md` rewritten.
- The starter's sample contracts removed with their deploy scripts and tests: `HederaToken.sol`, `HtsTokenCreator.sol`, `interfaces/IHederaTokenService.sol`. `packages/nextjs/contracts/deployedContracts.ts` no longer lists their testnet deployments.
- `packages/hardhat/scripts/generateTsAbis.ts`: a deploy that deploys nothing (any network without the Hedera Schedule Service) ends cleanly instead of throwing.
- `packages/nextjs`: the home page replaced; `Header.tsx` names the app and links its pages; `Footer.tsx` keeps the price, faucet and theme controls in the page flow instead of fixed over the content; `scaffold.config.ts` gains `referencePlan`; the burner wallet exists only in a build made with `NEXT_PUBLIC_ENABLE_BURNER_WALLET=true`.
- Root `package.json`: `gate:*`, `harness:run` and `hardhat:deploy:testnet` scripts; `hedera-harness` and `zod` dev dependencies; a third workspace package and its `saucerswap:*` scripts (see Added).
- `packages/nextjs/next.config.ts`: the optional `@x402/*` imports of `@coinbase/cdp-sdk` resolve to empty modules, so npm scaffolds build (the upstream blank starter fails `next build` on npm).

Added:

- `template.json` (manifest for create-scaffold-hbar).
- `tools/gate/` (eligibility gate scripts and their tests).
- `.github/workflows/gate.yml` (the same gate in CI).
- `.gitleaks.toml` (gitleaks defaults, minus the vendored Yarn release).
- `.harness/` (Hedera Harness v3 recipe and validators).
- `packages/saucerswap/` (`@sh/saucerswap`): a SaucerSwap V2 client with no React in it: addresses, quotes, swap paths and calldata, HTS association, relay gas price. The app uses it for the quote, the price floor and the fees.
- `packages/hardhat/contracts/RecurringBuy.sol`, the interfaces and mocks next to it, `test/RecurringBuy.test.ts` and `deploy/00_deploy_recurring_buy.ts`.
- `packages/nextjs`: routes `/plans/new` and `/plans`, `components/recurring-buy/`, `hooks/recurring-buy/` and `utils/recurring-buy/` with its tests and mirror node fixtures.
- `docs/testnet-findings.md`: what our two prototype runs measured on Hedera testnet on 2026-09-24 and 2026-09-29. The prototypes themselves are not in this repository; `RecurringBuy.sol` was written anew from what they showed.

Third-party code inside our files:

- `tools/gate/validate-template-json.mjs` contains a copy of the `template.json` zod schema from create-scaffold-hbar 0.4.0 `src/types.ts` (MIT, hedera-dev), so the gate validates the manifest exactly as the CLI parses it.
