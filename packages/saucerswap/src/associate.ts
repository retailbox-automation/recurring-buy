import { type Hex, encodeFunctionData, parseAbi } from "viem";

/**
 * HIP-719: every HTS token's proxy address answers these for `msg.sender` (no
 * constructor args) — docs.saucerswap.finance's examples call them the same way.
 */
export const hip719Abi = parseAbi([
  "function associate() returns (int64)",
  "function dissociate() returns (int64)",
  "function isAssociated() view returns (bool)",
]);

/**
 * Calldata for HIP-719 `associate()` — send it `to` the TOKEN's address, from the
 * account to associate. Costs real gas even though the token has no code of its
 * own: ~726k gas / ~0.79 HBAR on testnet (docs/PLATFORM-FINDINGS.md F9,
 * docs/research/spike-swap-2026-09-24.md S1) — surface that cost before sending it.
 */
export const associateCalldata = (): Hex => encodeFunctionData({ abi: hip719Abi, functionName: "associate" });

/** A single mirror node "/accounts/{id}/tokens" entry — only the field this module reads. */
export type MirrorTokenRelationship = { token_id: string };

/**
 * Reads whether `accountId` ("0.0.N") is associated with `tokenId` ("0.0.N") from
 * the mirror node's REST API — free, no RPC/gas cost, and works even for an
 * account with no EVM alias yet (docs/research/spike-swap-2026-09-24.md S1 read
 * this same endpoint to prove the association). `fetchImpl` defaults to the
 * global `fetch`; pass a stub in tests.
 */
export async function isAssociatedViaMirror(
  mirrorUrl: string,
  accountId: string,
  tokenId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = `${mirrorUrl}/accounts/${accountId}/tokens?token.id=${tokenId}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`mirror node ${url} returned ${res.status}`);
  const body = (await res.json()) as { tokens?: MirrorTokenRelationship[] };
  return (body.tokens ?? []).some(t => t.token_id === tokenId);
}
