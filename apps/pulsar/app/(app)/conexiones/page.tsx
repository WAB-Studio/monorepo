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
  // «hoy 09:40» for today, «el 5 oct» for any other day.
  const stamp = (instant: string, prefixed: boolean) =>
    civilDateInZone(new Date(instant)) === today
      ? `${t("connections.row.today")} ${timeInZone(instant)}`
      : prefixed
        ? t("connections.row.on", { date: dayOf(instant) })
        : `${dayOf(instant)} ${timeInZone(instant)}`;
  const live = (token: (typeof tokens)[number]) => {
    const family = token.kind === "oauth" ? "connections.oauth" : "connections.row";
    const created = stamp(token.createdAt, true);
    return token.lastUsedAt
      ? t(`${family}.metaUsed`, { created, used: stamp(token.lastUsedAt, false) })
      : t(`${family}.metaUnused`, { created });
  };

  const rows: ConnectionRow[] = tokens.map((token) => ({
    id: token.id,
    kind: token.kind,
    name: token.name,
    revoked: token.revokedAt !== null,
    meta: token.revokedAt
      ? t("connections.row.revokedMeta", { date: dayOf(token.revokedAt) })
      : live(token),
  }));

  return <ConnectionsScreen rows={rows} siteUrl={env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")} />;
}
