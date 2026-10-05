import { isIPv6 } from "node:net";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { fingerprint } from "@/lib/mcp/tokens";

export const LIMITS = {
  register: { cap: 10, windowSeconds: 3600 },
  token: { cap: 30, windowSeconds: 300 },
} as const;

export type Bucket = keyof typeof LIMITS;

// The 16 bytes of an IPv6 literal, `::` expanded; null when it does not parse.
function v6Groups(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16)));
  const head = read(halves[0]);
  const tail = halves.length === 2 ? read(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tail];

  return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/**
 * The caller's address from `x-forwarded-for`, whose first value is the client
 * once the platform overwrites the header. IPv6 is reduced to its /64, the
 * block one host holds. A missing or unparsable header is one shared `"unknown"`.
 */
export function callerAddress(request: { headers: { get(name: string): string | null } }): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(first) && first.split(".").every((part) => Number(part) <= 255)) return first;
  if (isIPv6(first.split("%")[0])) {
    const groups = v6Groups(first.split("%")[0]);
    if (groups) return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
  }

  return "unknown";
}

/**
 * Counts one call against the address's window in one statement, so two calls
 * cannot both slip under the cap. Only a fingerprint of the address is stored.
 */
export async function claimCall(
  bucket: Bucket,
  address: string,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const { cap, windowSeconds } = LIMITS[bucket];
  const rows = await db.execute<{ wait: number }>(sql`
    select goals.oauth_claim_call(${bucket}, ${fingerprint(address)}, ${cap}, ${windowSeconds}) as wait`);
  const wait = rows[0].wait;

  return wait === 0 ? { ok: true } : { ok: false, retryAfter: wait };
}

export function tooMany(retryAfter: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "too_many_requests" }), {
    status: 429,
    headers: {
      ...cors,
      "Retry-After": String(retryAfter),
      "Access-Control-Expose-Headers": "Retry-After",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
