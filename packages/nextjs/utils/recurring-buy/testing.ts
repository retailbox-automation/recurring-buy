import { type Mirror, createMirror } from "./mirror";

export const TESTNET_MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

/**
 * A mirror node that answers from `routes` (path under /api/v1 → JSON body) and 404s anything else. `requested` lists
 * every path asked for, so a test can check which endpoints the code used.
 */
export function fixtureMirror(routes: Record<string, unknown>): { mirror: Mirror; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = String(input).slice(TESTNET_MIRROR.length);
    requested.push(path);
    const body = routes[path];
    return body === undefined
      ? new Response(JSON.stringify({ _status: { messages: [{ message: "Not found" }] } }), { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { mirror: createMirror(TESTNET_MIRROR, fetchImpl), requested };
}
