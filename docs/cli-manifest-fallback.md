# When create-scaffold-hbar cannot read template.json

create-scaffold-hbar 0.4.1 reads a community template's `template.json` through the GitHub REST API, without a token and with a 10-second timeout (`fetchTemplateManifestFromGithub` in its `dist/cli.js`). The request carries no `Authorization` header, so a `GITHUB_TOKEN` in the environment does not change it. GitHub allows 60 unauthenticated API requests an hour from one IP address.

When that request does not return 200, the CLI does not report it. `resolveTemplateCapabilities` falls back to its default capabilities, and in `--ci` mode the scaffold uses the CLI's own defaults: Foundry and Yarn. The template's `defaults` are ignored, so a template that defaults to Hardhat, or that supports only npm, is scaffolded with a framework it may not ship, or the run stops.

## Reproduction

2026-10-03, create-scaffold-hbar 0.4.1, Node 26.10.0, macOS. `fail-manifest.mjs` answers 403 to the one `template.json` request, the response GitHub gives when the unauthenticated limit is used up, and passes every other request through:

```js
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (/api\.github\.com\/repos\/.+\/contents\/template\.json/.test(url)) {
    return new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403 });
  }
  return real(input, init);
};
```

Each run is `npx --yes create-scaffold-hbar@0.4.1 <dir> --template retailbox-automation/recurring-buy --ci --skip-install`, with the extra arguments in the table; `NODE_OPTIONS="--import=./fail-manifest.mjs"` adds the 403.

| Run | `template.json` request | Result |
| --- | --- | --- |
| As is | 200 | Hardhat and Yarn, the template's defaults: `packages/hardhat`, `packages/nextjs`, `packages/saucerswap` |
| With the 403, Foundry not installed | 403 | Exit 1: `FoundryValidationError: Could not parse foundry version` |
| With the 403, Foundry 1.7.1 on `PATH` | 403 | Foundry and Yarn: `packages/foundry`, `packages/nextjs`, `packages/saucerswap` |
| With the 403 and `-s hardhat --package-manager yarn` | 403 | Hardhat and Yarn, as in the first run |

## What to do

- Name the framework and the package manager on the command line. Arguments after `--` reach the CLI:

  ```bash
  npm create scaffold-hbar@latest my-app -- --template retailbox-automation/recurring-buy -s hardhat --package-manager yarn
  ```

- This template ships the contract with Hardhat (the default) and with Foundry, and `tools/gate/local-gate.sh` checks all four combinations of framework (Hardhat, Foundry) and package manager (Yarn, npm) ([checks.md](checks.md)). So when the fallback picks Foundry and Yarn, and Foundry is installed, the result is still a working project.

## In this repository's CI

On 2026-10-03 the fallback failed the Hardhat leg of the template gate three times, with `FoundryValidationError` 4 seconds after create-scaffold-hbar 0.4.0 started: both attempts of run [37158403863](https://github.com/retailbox-automation/recurring-buy/actions/runs/37158403863) (Node 20.18.3) and run [37156540456](https://github.com/retailbox-automation/recurring-buy/actions/runs/37156540456) (Node 24). The other nine legs of each run passed. 4 seconds is less than the CLI's 10-second timeout, so the request did not time out: it got an answer other than 200, or a network error. The gate did not log which.

The gate now runs create-scaffold-hbar 0.4.1 and scaffolds again when it sees the fallback, up to 3 times (`tools/gate/scaffold-retry.mjs`). Before each new attempt it reads GitHub's rate limit for requests without a token (`/rate_limit`, which does not count against it), prints it, and waits for the reset when no requests are left. A fallback on all 3 attempts fails the gate with that reason; any other failure fails at once.
