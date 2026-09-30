import type { GasPrice } from "./mirror";

/** Gas this template's transactions used on testnet (docs/testnet-findings.md, E4). */
export const MEASURED_GAS = {
  /** A tick that bought and scheduled the next one. */
  tick: 1_605_224n,
} as const;

/** Tinybar a tick costs at `price`: a scheduled tick is billed as a contract call (E2). */
export const tickCost = (price: GasPrice) => MEASURED_GAS.tick * price.contractCall;
