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
- `README.md`, `AGENTS.md`, `CLAUDE.md` rewritten.
- Root `package.json`: `gate:*`, `harness:run` and `hardhat:deploy:testnet` scripts; `hedera-harness` and `zod` dev dependencies.
- `packages/nextjs/next.config.ts`: the optional `@x402/*` imports of `@coinbase/cdp-sdk` resolve to empty modules, so npm scaffolds build (the upstream blank starter fails `next build` on npm).

Added:

- `template.json` (manifest for create-scaffold-hbar).
- `tools/gate/` (eligibility gate scripts and their tests).
- `.github/workflows/gate.yml` (the same gate in CI).
- `.gitleaks.toml` (gitleaks defaults, minus the vendored Yarn release).
- `.harness/` (Hedera Harness v3 recipe and validators).

Third-party code inside our files:

- `tools/gate/validate-template-json.mjs` contains a copy of the `template.json` zod schema from create-scaffold-hbar 0.4.0 `src/types.ts` (MIT, hedera-dev), so the gate validates the manifest exactly as the CLI parses it.
