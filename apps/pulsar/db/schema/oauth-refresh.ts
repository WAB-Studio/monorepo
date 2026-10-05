import { timestamp, uuid } from "drizzle-orm/pg-core";

import { goalsSchema } from "./_schema";
import { accessTokens, bytea } from "./access-tokens";
import { oauthClients } from "./oauth-clients";

// A refresh token's fingerprint (RP-41). RLS on, no policy and no grant: only
// the SECURITY DEFINER functions touch it.
export const oauthRefresh = goalsSchema
  .table("oauth_refresh", {
    id: uuid().primaryKey().defaultRandom(),
    accessTokenId: uuid()
      .notNull()
      .references(() => accessTokens.id, { onDelete: "cascade" }),
    clientId: uuid()
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    refreshHash: bytea().notNull().unique("oauth_refresh_refresh_hash_unique"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp({ withTimezone: true }),
  })
  .enableRLS();

export type OauthRefresh = typeof oauthRefresh.$inferSelect;
