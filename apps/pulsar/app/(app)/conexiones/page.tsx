import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ConnectionsScreen, type ConnectionRow } from "@/components/connections/connections-screen";
import { env } from "@/lib/env";
import { listAccessTokens } from "@/lib/queries/tokens";
import { getPerson } from "@/lib/session";
import { civilDateInZone, civilDayMonthShort, timeInZone, todayInZone } from "@/lib/zone";

const dayOf = (instant: string) => civilDayMonthShort(civilDateInZone(new Date(instant)));

// Static per route: no title reads a goal or costs a statement (RNP-01).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.titles");
  return { title: t("connections") };
}

// The auth gate, the list, and the words each row reads. The key a person just
// made is not here: it lives in the screen's state and nowhere a render reaches.
export default async function ConnectionsPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const [tokens, t] = await Promise.all([listAccessTokens(), getTranslations()]);

  const today = todayInZone();
  const used = (instant: string | null) => {
    if (!instant) return t("connections.row.neverUsed");
    const when = civilDateInZone(new Date(instant)) === today ? t("connections.row.today") : dayOf(instant);
    return `${when} ${timeInZone(instant)}`;
  };

  const rows: ConnectionRow[] = tokens.map((token) => ({
    id: token.id,
    kind: token.kind,
    name: token.name,
    revoked: token.revokedAt !== null,
    meta: token.revokedAt
      ? t("connections.row.revokedMeta", { date: dayOf(token.revokedAt) })
      : token.kind === "oauth"
        ? t("connections.oauth.meta", { date: dayOf(token.createdAt), used: used(token.lastUsedAt) })
        : t("connections.row.meta", { created: dayOf(token.createdAt), used: used(token.lastUsedAt) }),
  }));

  return <ConnectionsScreen rows={rows} siteUrl={env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")} />;
}
