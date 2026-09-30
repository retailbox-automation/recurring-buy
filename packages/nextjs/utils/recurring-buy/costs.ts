import type { GasPrice } from "./mirror";

/** Gas this template's transactions used on testnet (docs/testnet-findings.md, runs E and F). */
export const MEASURED_GAS = {
  /** HIP-719 `associate()` (A1, E). */
  associate: 726_488n,
  /** WhbarHelper `deposit()` into an account associated with WHBAR (F1). */
  wrap: 77_966n,
  /** `approve` on the spend token (E). */
  approve: 727_032n,
  /** `start` (E4). */
  start: 1_637_955n,
  /** Added to `start` once, for the first plan on a spend token: the contract associates and approves (E4). */
  prepareToken: 1_476_561n,
  /** A tick that bought and scheduled the next one (E4). */
  tick: 1_605_224n,
} as const;

/** Tinybar a tick costs at `price`: a scheduled tick is billed as a contract call (E2). */
export const tickCost = (price: GasPrice) => MEASURED_GAS.tick * price.contractCall;

/** The gas limit to send with a transaction: its estimate plus 20%. Hedera bills the gas used, not the limit (E1). */
export const gasLimitFor = (estimate: bigint) => (estimate * 12n) / 10n;

export type SignStep = {
  kind: "associate-out" | "associate-in" | "wrap" | "approve" | "start";
  gas: bigint;
  /** Listed before the wallet's state is known: skipped if it turns out to be done already. */
  ifNeeded: boolean;
  /** Tinybar of HBAR to wrap, for "wrap". */
  amount?: bigint;
};

/** What the wallet holds; a field is undefined until it is read. */
export type WalletState = {
  holdsOut?: boolean;
  holdsIn?: boolean;
  balanceIn?: bigint;
  allowance?: bigint;
};

/**
 * The transactions a person signs to start a plan that spends `need` of the spend token in total, in order. The buy
 * token is associated even when the account would associate it automatically: an automatic association during a tick
 * costs more gas than the tick leaves for its swap (D3). WHBAR can be wrapped from HBAR here, after associating it,
 * which SaucerSwap asks for before a deposit (D2).
 */
export function stepsToSign({
  spendIsWhbar,
  need,
  tokenReady,
  wallet,
}: {
  spendIsWhbar: boolean;
  need: bigint;
  /** False when this is the first plan on the contract for the spend token. */
  tokenReady: boolean | undefined;
  wallet: WalletState;
}): SignStep[] {
  const steps: SignStep[] = [];
  const add = (kind: SignStep["kind"], gas: bigint, known: boolean, amount?: bigint) =>
    steps.push({ kind, gas, ifNeeded: !known, ...(amount === undefined ? {} : { amount }) });

  if (wallet.holdsOut !== true) add("associate-out", MEASURED_GAS.associate, wallet.holdsOut !== undefined);
  const shortfall = wallet.balanceIn === undefined ? need : need - wallet.balanceIn;
  if (spendIsWhbar && shortfall > 0n) {
    if (wallet.holdsIn !== true) add("associate-in", MEASURED_GAS.associate, wallet.holdsIn !== undefined);
    add("wrap", MEASURED_GAS.wrap, wallet.balanceIn !== undefined, shortfall);
  }
  if (wallet.allowance === undefined || wallet.allowance < need)
    add("approve", MEASURED_GAS.approve, wallet.allowance !== undefined);
  add("start", MEASURED_GAS.start + (tokenReady === false ? MEASURED_GAS.prepareToken : 0n), true);
  return steps;
}
