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
};

type TokenRow = {
  id: string;
  kind: "personal" | "oauth";
  name: string;
  hint: string | null;
  created_at: string | Date;
  last_used_at: string | Date | null;
  revoked_at: string | Date | null;
};

const iso = (value: string | Date) => new Date(value).toISOString();

// Names the granted columns: `token_hash` is in no grant, so selecting it
// would fail with 42501. RLS alone scopes the rows to the person.
export async function listAccessTokens(): Promise<AccessToken[]> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<TokenRow>(sql`
      select id, kind, name, hint, created_at, last_used_at, revoked_at
        from "goals"."access_tokens"
        order by (revoked_at is not null), created_at desc
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
  }));
}
