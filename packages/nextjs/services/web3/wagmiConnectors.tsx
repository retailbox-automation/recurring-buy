import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

const wallets = [metaMaskWallet, walletConnectWallet];

const DEV_CHAIN_IDS = new Set<number>([chains.hardhat.id, chains.foundry.id, chains.hederaTestnet.id]);

const hasDevNetwork = scaffoldConfig.targetNetworks.some(n => DEV_CHAIN_IDS.has(n.id));

export const wagmiConnectors = () => {
  if (typeof window === "undefined") {
    return [];
  }

  const walletGroups = [
    {
      groupName: "Supported Wallets",
      wallets,
    },
  ];

  // Inlined at build time, so without the flag this branch and the burner-connector package are left out of the bundle.
  if (process.env.NEXT_PUBLIC_ENABLE_BURNER_WALLET === "true" && scaffoldConfig.enableBurnerWallet && hasDevNetwork) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rainbowkitBurnerWallet } = require("burner-connector") as typeof import("burner-connector");
    walletGroups.push({
      groupName: "Development",
      wallets: [rainbowkitBurnerWallet],
    });
  }

  return connectorsForWallets(walletGroups, {
    appName: "scaffold-hbar",
    projectId: scaffoldConfig.walletConnectProjectId,
  });
};
