# Hedera Harness recipe

[Hedera Harness](https://github.com/hedera-dev/hedera-harness) is pinned to `2.0.0-rc.4` (recipe schema v3) in the root `devDependencies`. This directory is the recipe:

| File | Purpose |
| --- | --- |
| `spec.yaml` | baseline commands and the validators to run |
| `validators/static.json` | required files, forbidden `.env` files, `template.json` and harness pin assertions (checked only where `template.json` exists; the CLI deletes it from scaffolded projects) |
| `validators/yarn.json` | install, lint with zero warnings, contract compile and Next.js build, contract tests |
| `validators/npm.json` | the same commands for a project created with `--package-manager npm` |
| `validators/playwright-smoke.yaml` | boots the app and renders the core routes; `tools/gate/local-gate.sh` probes the same routes over HTTP |

```bash
npx hedera-harness doctor     # checks the setup; no agent, no keys
npx hedera-harness validate   # install, lint, build, test, secret scan, then renders the core routes in a browser
yarn harness:run              # agent run on a new harness/run-* branch; needs a clean tree and a logged-in Claude Code or Cursor CLI
```

The recipe runs Yarn commands. create-scaffold-hbar copies this directory unchanged into npm projects, so in a project created with `--package-manager npm`:

1. In `spec.yaml`, set `validators.commands` to `.harness/validators/npm.json`.
2. Change the baseline commands to `npm install --legacy-peer-deps` and `npm run next:build`.
3. Change `server.command` in `validators/playwright-smoke.yaml` to `npm run next:start`.

Feature increments (`prd:` in `spec.yaml`) are not written yet, so `doctor` reports the missing PRD and `harness:run` has nothing to build. Chain validation, once enabled, reads `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` (ECDSA) from the shell; they never go into a file in the repository.

Runtime output (`runs/`, `runtime/`, `cache/`, `.skill-cache/`) is gitignored.
