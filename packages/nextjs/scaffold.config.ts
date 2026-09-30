import * as chains from "viem/chains";

export type ScaffoldConfig = {
  targetNetworks: readonly [chains.Chain, ...chains.Chain[]];
  pollingInterval: number;
  rpcOverrides?: Record<number, string>;
  enableBurnerWallet: boolean;
  walletConnectProjectId: string;
  referencePlan: ReferencePlan;
};

/**
 * A plan anyone can watch on the home page, read from the mirror node with no wallet. `contract` is null until a
 * RecurringBuy is deployed and has run a plan; the home page then says so.
 */
export type ReferencePlan = {
  chainId: number;
  contract: `0x${string}` | null;
  planId: bigint;
};

const hederaLocalFork = {
  ...chains.hardhat,
  name: "Hedera Local Fork",
  nativeCurrency: {
    name: "HBAR",
    symbol: "HBAR",
    // Note: HBAR has 8 protocol decimals (tinybar),
    // but JSON-RPC msg.value & gasPrice use 18 decimals for EVM compatibility.
    // We keep 18 here so tx.value formatting matches what viem/hardhat return.
    decimals: 18,
  },
} as const satisfies chains.Chain;

const targetNetworks = [chains.hederaTestnet, chains.hedera, hederaLocalFork] as const satisfies readonly [
  chains.Chain,
  ...chains.Chain[],
];

const scaffoldConfig = {
  targetNetworks,

  pollingInterval: 10000,

  // A burner wallet keeps its private key in the browser's localStorage. It is for automated tests and local
  // demos only, so it exists only in a build made with NEXT_PUBLIC_ENABLE_BURNER_WALLET=true (see next.config.ts).
  enableBurnerWallet: process.env.NEXT_PUBLIC_ENABLE_BURNER_WALLET === "true",

  rpcOverrides: {
    [chains.hedera.id]: process.env.NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL || "https://mainnet.hashio.io/api",
    [chains.hederaTestnet.id]: process.env.NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  },

  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",

  referencePlan: {
    chainId: chains.hederaTestnet.id,
    // TODO(deploy): the address of the testnet RecurringBuy that runs this template's reference plan.
    contract: null,
    planId: 1n,
  },
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
