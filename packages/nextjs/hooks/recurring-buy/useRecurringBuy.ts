import { useMemo } from "react";
import {
  ADDRESSES,
  ENDPOINTS,
  type Network,
  encodeSingleHopPath,
  hashioGasPrice,
  hederaIdToLongZeroAddress,
  quoteExactInput,
} from "@sh/saucerswap";
import { useQueries, useQuery } from "@tanstack/react-query";
import * as chains from "viem/chains";
import { usePublicClient } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import scaffoldConfig, { type ReferencePlan } from "~~/scaffold.config";
import { type Mirror, createMirror, fetchGasPrice, fetchTickCharge } from "~~/utils/recurring-buy/mirror";
import { type PlanView, loadContractEvents, plansOwnedBy, resolvePlan } from "~~/utils/recurring-buy/plan";
import { contracts } from "~~/utils/scaffold-hbar/contract";

const MIRROR_BY_CHAIN: Record<number, string> = {
  [ENDPOINTS.testnet.chainId]: ENDPOINTS.testnet.mirrorUrl,
  [ENDPOINTS.mainnet.chainId]: ENDPOINTS.mainnet.mirrorUrl,
};

const SAUCERSWAP_NETWORK: Record<number, Network> = {
  [ENDPOINTS.testnet.chainId]: "testnet",
  [ENDPOINTS.mainnet.chainId]: "mainnet",
};

const CHAINS_BY_ID: Record<number, chains.Chain> = {
  [chains.hederaTestnet.id]: chains.hederaTestnet,
  [chains.hedera.id]: chains.hedera,
};

export const referencePlan: ReferencePlan = scaffoldConfig.referencePlan;

export type RecurringBuyNetwork = {
  chainId: number;
  networkName: string;
  /**
   * The RecurringBuy plans are made on: this project's deployment from deployedContracts.ts, or else the reference
   * plan's contract when it is on this network. Undefined when neither exists.
   */
  contract: `0x${string}` | undefined;
  /** Null on a network without a public mirror node (the local fork). */
  mirror: Mirror | null;
  /** Hashscan for the network, e.g. https://hashscan.io/testnet. */
  explorer: string | null;
};

function networkFor(chainId: number, name: string, contract: `0x${string}` | undefined): RecurringBuyNetwork {
  const mirrorUrl = MIRROR_BY_CHAIN[chainId];
  return {
    chainId,
    networkName: name,
    contract,
    mirror: mirrorUrl ? createMirror(mirrorUrl) : null,
    explorer: CHAINS_BY_ID[chainId]?.blockExplorers?.default.url ?? null,
  };
}

/** The selected network's RecurringBuy and how to read it. No network requests. */
export function useRecurringBuyNetwork(): RecurringBuyNetwork {
  const { targetNetwork } = useTargetNetwork();
  const deployed = contracts?.[targetNetwork.id]?.RecurringBuy?.address as `0x${string}` | undefined;
  const contract =
    deployed ?? (referencePlan.chainId === targetNetwork.id ? (referencePlan.contract ?? undefined) : undefined);
  return useMemo(
    () => networkFor(targetNetwork.id, targetNetwork.name, contract),
    [targetNetwork.id, targetNetwork.name, contract],
  );
}

/** The reference plan's network, whatever network the wallet is on. */
export function useReferenceNetwork(): RecurringBuyNetwork {
  return useMemo(
    () =>
      networkFor(
        referencePlan.chainId,
        CHAINS_BY_ID[referencePlan.chainId]?.name ?? `chain ${referencePlan.chainId}`,
        referencePlan.contract ?? undefined,
      ),
    [],
  );
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * How soon to read a plan again: often while a tick is about to run, every minute once the chain looks broken or a
 * stopped plan still shows an open tick (a late mirror node or a schedule `stop` could not delete), never once nothing
 * more can happen.
 */
function refetchAfter(plan: PlanView): number | false {
  const { status, ticks } = plan;
  if (status.kind === "running") return status.due - nowSeconds() > 120 ? 30_000 : 5_000;
  if (status.kind === "due" || status.kind === "indexing") return 5_000;
  if (status.kind === "broken") return 60_000;
  const open = ticks.some(row => ["waiting", "due", "indexing"].includes(row.outcome.kind));
  return open ? 60_000 : false;
}

export type PlanLookup = {
  /** Null when the contract has no such plan among the events read. */
  plan: PlanView | null;
  /** The contract has more events than were read, and the plan's creation was not among them. */
  truncated: boolean;
};

/** One plan's history and chain status. */
export function usePlan(network: RecurringBuyNetwork, planId: bigint | undefined) {
  const { mirror, contract, chainId } = network;
  return useQuery({
    queryKey: ["recurring-buy", "plan", chainId, contract, planId?.toString()],
    queryFn: async (): Promise<PlanLookup> => {
      const loaded = await loadContractEvents(mirror!, contract!, { planId });
      if (!loaded) return { plan: null, truncated: false };
      return { plan: await resolvePlan(mirror!, loaded, planId!, nowSeconds()), truncated: loaded.truncated };
    },
    enabled: Boolean(mirror && contract && planId !== undefined),
    // A plan not found yet may still be indexing (right after `start`); one beyond the pages read will not appear.
    refetchInterval: ({ state: { data } }) =>
      !data ? false : data.plan ? refetchAfter(data.plan) : !data.truncated && 10_000,
    retry: 1,
  });
}

/** Every plan `owner` made on the network's RecurringBuy, newest first. */
export function useOwnerPlans(network: RecurringBuyNetwork, owner: string | undefined) {
  const { mirror, contract, chainId } = network;
  return useQuery({
    queryKey: ["recurring-buy", "owner-plans", chainId, contract, owner],
    queryFn: async () => {
      const loaded = await loadContractEvents(mirror!, contract!);
      if (!loaded) return { plans: [] as PlanView[], truncated: false };
      const now = nowSeconds();
      const plans = await Promise.all(
        plansOwnedBy(loaded.events, owner!).map(id => resolvePlan(mirror!, loaded, id, now)),
      );
      return { plans: plans.filter((plan): plan is PlanView => plan !== null), truncated: loaded.truncated };
    },
    enabled: Boolean(mirror && contract && owner),
    refetchInterval: query => {
      const intervals = (query.state.data?.plans ?? []).map(refetchAfter).filter(ms => ms !== false);
      return intervals.length ? Math.min(...intervals) : false;
    },
    retry: 1,
  });
}

/** The contract's Hedera id, "0.0.N", which the mirror node's per-execution endpoints are keyed by. */
export function useContractId(network: RecurringBuyNetwork) {
  const { mirror, contract, chainId } = network;
  return useQuery({
    queryKey: ["recurring-buy", "contract-id", chainId, contract],
    queryFn: async () => (await mirror!.get<{ contract_id: string }>(`/contracts/${contract}`))?.contract_id ?? null,
    enabled: Boolean(mirror && contract),
    staleTime: Infinity,
  });
}

/** Tinybar the contract paid for each executed tick, by consensus timestamp; missing while loading. */
export function useTickCharges(
  network: RecurringBuyNetwork,
  contractId: string | null | undefined,
  timestamps: string[],
) {
  const { mirror, chainId } = network;
  const results = useQueries({
    queries: timestamps.map(timestamp => ({
      queryKey: ["recurring-buy", "tick-charge", chainId, contractId, timestamp],
      queryFn: () => fetchTickCharge(mirror!, contractId!, timestamp),
      enabled: Boolean(mirror && contractId),
      staleTime: Infinity,
    })),
  });
  const charges: Record<string, bigint> = {};
  timestamps.forEach((timestamp, i) => {
    const charge = results[i]?.data;
    if (typeof charge === "bigint") charges[timestamp] = charge;
  });
  return charges;
}

export type TokenInfo = { symbol: string; decimals: number };

/** Symbol and decimals of an HTS token (its EVM address is its long-zero id); null when the mirror has no such token. */
export function useTokenInfo(network: RecurringBuyNetwork, token: string | undefined) {
  const { mirror, chainId } = network;
  return useQuery({
    queryKey: ["recurring-buy", "token", chainId, token?.toLowerCase()],
    queryFn: async (): Promise<TokenInfo | null> => {
      const info = await mirror!.get<{ symbol: string; decimals: string }>(`/tokens/0.0.${BigInt(token!)}`);
      return info ? { symbol: info.symbol, decimals: Number(info.decimals) } : null;
    },
    enabled: Boolean(mirror && token),
    staleTime: Infinity,
  });
}

/** The gas price the network bills, for showing what a transaction or a tick costs. */
export function useGasPrice(network: RecurringBuyNetwork) {
  const { mirror, chainId } = network;
  return useQuery({
    queryKey: ["recurring-buy", "gas-price", chainId],
    queryFn: () => fetchGasPrice(mirror!),
    enabled: Boolean(mirror),
    refetchInterval: 300_000,
  });
}

/**
 * Fee fields for a transaction through hashio: the max fee from `eth_gasPrice`, no priority fee. hashio's block header
 * reports a base fee far below its minimum gas price, so fees a wallet derives from it are rejected.
 */
export function useHederaFees(chainId: number) {
  const publicClient = usePublicClient({ chainId });
  return async () => {
    if (!publicClient) throw new Error("No RPC client for this network.");
    return { maxFeePerGas: await hashioGasPrice(publicClient), maxPriorityFeePerGas: 0n };
  };
}

export type MirrorAccount = {
  accountId: string;
  balanceTinybar: bigint;
  /** -1 means unlimited: tokens associate on first receipt. */
  maxAutoAssociations: number;
  /** Balances of the associated tokens among those asked for, by lowercase long-zero address. */
  tokens: Record<string, bigint>;
};

/** The wallet's Hedera account from the mirror node; null when the address has no account yet. */
export function useMirrorAccount(network: RecurringBuyNetwork, address: string | undefined, tokens: string[]) {
  const { mirror, chainId } = network;
  return useQuery({
    queryKey: ["recurring-buy", "account", chainId, address, tokens.map(t => t.toLowerCase()).join()],
    queryFn: async (): Promise<MirrorAccount | null> => {
      const account = await mirror!.get<{
        account: string;
        deleted: boolean;
        balance: { balance: number };
        max_automatic_token_associations: number;
      }>(`/accounts/${address}?transactions=false`);
      if (!account || account.deleted) return null;
      const held = await Promise.all(
        tokens.map(token =>
          mirror!.get<{ tokens: { token_id: string; balance: number }[] }>(
            `/accounts/${account.account}/tokens?token.id=0.0.${BigInt(token)}`,
          ),
        ),
      );
      const entries = held.flatMap(found => found?.tokens ?? []);
      return {
        accountId: account.account,
        balanceTinybar: BigInt(account.balance.balance),
        maxAutoAssociations: account.max_automatic_token_associations,
        tokens: Object.fromEntries(entries.map(t => [hederaIdToLongZeroAddress(t.token_id), BigInt(t.balance)])),
      };
    },
    enabled: Boolean(mirror && address),
    refetchInterval: 10_000,
  });
}

/** SaucerSwap V2 QuoterV2's output for one slice, via `eth_call`; errors when the pool has no route or liquidity. */
export function useQuote(
  chainId: number,
  route: { tokenIn: string; fee: number; tokenOut: string } | null,
  amountIn: bigint,
) {
  const publicClient = usePublicClient({ chainId });
  const saucerSwap = SAUCERSWAP_NETWORK[chainId];
  return useQuery({
    queryKey: ["recurring-buy", "quote", chainId, route?.tokenIn, route?.fee, route?.tokenOut, amountIn.toString()],
    queryFn: () =>
      quoteExactInput(
        publicClient!,
        ADDRESSES[saucerSwap].quoter,
        encodeSingleHopPath(route!.tokenIn as `0x${string}`, route!.fee, route!.tokenOut as `0x${string}`),
        amountIn,
      ),
    enabled: Boolean(publicClient && saucerSwap && route && amountIn > 0n),
    refetchInterval: 30_000,
    retry: false,
  });
}

/** The default pair for a network: WHBAR to SAUCE on testnet, the pool the prototypes swapped through. */
export function defaultRoute(chainId: number): { tokenIn: string; fee: number; tokenOut: string } | null {
  if (chainId !== ENDPOINTS.testnet.chainId) return null;
  return { tokenIn: ADDRESSES.testnet.whbar, fee: 3000, tokenOut: hederaIdToLongZeroAddress("0.0.1183558") };
}
