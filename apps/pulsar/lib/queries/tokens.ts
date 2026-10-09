import "server-only";

import { sql } from "drizzle-orm";

import { withGoalsDb } from "@/lib/session";

export type AccessToken = {
  id: string;
  kind: "personal" | "oauth";
  name: string;
  hint: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiredAt: string | null;
};

type TokenRow = {
  id: string;
  kind: "personal" | "oauth";
  name: string;
  hint: string | null;
  created_at: string | Date;
  last_used_at: string | Date | null;
  revoked_at: string | Date | null;
  expired_at: string | Date | null;
};

const iso = (value: string | Date) => new Date(value).toISOString();

// Names the granted columns: `token_hash` is in no grant, so selecting it
// would fail with 42501. RLS alone scopes the rows to the person.
// `lapses_at` is the door's rule read forward (0015, RNP-20): a personal key
// counts from its last use, else its creation; an OAuth connection's
// `expires_at` is its access token's hour, minted with the refresh that carries
// the last use. A revoked key is never expired. Same `'90 days'` literal as 0015.
export async function listAccessTokens(): Promise<AccessToken[]> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<TokenRow>(sql`
      select id, kind, name, hint, created_at, last_used_at, revoked_at,
             case when lapses_at <= now() then lapses_at end as expired_at
        from (
          select id, kind, name, hint, created_at, last_used_at, revoked_at,
                 case
                   when revoked_at is not null then null
                   when kind = 'oauth' then expires_at - interval '1 hour' + interval '90 days'
                   else coalesce(last_used_at, created_at) + interval '90 days'
                 end as lapses_at
            from "goals"."access_tokens"
        ) t
        order by (revoked_at is not null), (lapses_at <= now()) nulls first, created_at desc
    `),
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    hint: row.hint,
    createdAt: iso(row.created_at),
    lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    expiredAt: row.expired_at ? iso(row.expired_at) : null,
  }));
}
