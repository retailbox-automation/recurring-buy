"use client";

import { Panel } from "./common";
import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { useCopyToClipboard } from "~~/hooks/scaffold-hbar";

const TEMPLATE = "retailbox-automation/recurring-buy";

/** The command that creates a project from this template, with a copy button. */
export const ForDevelopers = () => {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();
  const Icon = isCopiedToClipboard ? CheckIcon : DocumentDuplicateIcon;
  return (
    <Panel title="For developers">
      <p className="m-0 -mt-3 text-sm text-base-content/60">Get started with the scaffold in one command.</p>
      <div className="mt-4 rounded-xl bg-hedera-charcoal text-white p-4 dark:border dark:border-base-content/10">
        <div className="flex items-center justify-between mb-3">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-error" />
            <span className="size-2.5 rounded-full bg-warning" />
            <span className="size-2.5 rounded-full bg-success" />
          </span>
          <button
            className="btn btn-ghost btn-xs btn-square text-white hover:bg-white/10"
            aria-label="Copy the command"
            onClick={() => copyToClipboard(`npm create scaffold-hbar@latest my-app -- --template ${TEMPLATE}`)}
          >
            <Icon className="size-4" />
          </button>
        </div>
        <code className="block text-xs leading-relaxed whitespace-pre overflow-x-auto">
          {`npm create scaffold-hbar@latest \\\n  my-app -- --template \\\n  ${TEMPLATE}`}
        </code>
      </div>
      <p className="m-0 mt-4 text-sm text-base-content/70">
        Contract with tests (Hardhat and Foundry), Next.js app, SaucerSwap client, AGENTS.md.
      </p>
    </Panel>
  );
};
