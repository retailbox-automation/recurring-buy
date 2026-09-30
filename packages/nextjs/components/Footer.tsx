import React from "react";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import { hedera } from "viem/chains";
import { CurrencyDollarIcon } from "@heroicons/react/24/outline";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { useFetchHbarPrice } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";

/**
 * Site footer
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isTestnet = targetNetwork.id !== hedera.id;
  const { price: nativeCurrencyPrice } = useFetchHbarPrice();

  return (
    <div className="min-h-0 py-5 px-4 flex flex-col gap-4">
      {/* In the page flow, not fixed to the viewport: fixed controls sat on top of the plan's status line. */}
      <div className="flex flex-wrap justify-between items-center gap-2 w-full">
        <div className="flex flex-wrap gap-2">
          {nativeCurrencyPrice > 0 && (
            <div className="btn btn-primary btn-sm font-normal gap-1 cursor-auto">
              <CurrencyDollarIcon className="h-4 w-4" />
              <span>{nativeCurrencyPrice.toFixed(2)}</span>
            </div>
          )}
          {isTestnet && <HederaPortalFaucet showIcon />}
        </div>
        <SwitchTheme />
      </div>
      <div className="w-full">
        <ul className="menu menu-horizontal w-full">
          <div className="flex justify-center items-center gap-3 text-sm w-full text-base-content/60">
            <a
              href="https://github.com/hedera-dev/scaffold-hbar"
              target="_blank"
              rel="noreferrer"
              className="link hover:text-primary"
            >
              GitHub
            </a>
            <span className="opacity-30">|</span>
            <span>
              Built on{" "}
              <a
                href="https://hedera.com/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold link hover:text-primary"
              >
                Hedera
              </a>
            </span>
            <span className="opacity-30">|</span>
            <a href="https://docs.hedera.com/" target="_blank" rel="noreferrer" className="link hover:text-primary">
              Docs
            </a>
          </div>
        </ul>
      </div>
    </div>
  );
};
