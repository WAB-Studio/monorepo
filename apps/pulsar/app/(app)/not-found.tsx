import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button, Page, Text } from "@/components/ui";

/**
 * `NoEncontrada.dc.html` (RNP-01). Reached from inside the app — `/dia/zzz`,
 * an unknown goal — where `app/(app)/layout.tsx` already draws the nav, so
 * this draws none. The one line under the title names no route: it serves a
 * date and a goal alike. `app/not-found.tsx` adds the nav for what the app
 * does not route at all.
 */
export default async function NotFound() {
  const t = await getTranslations("common.notFound");

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {t("kicker")}
      </Text>
      <Text asChild variant="title">
        <h1>{t("title")}</h1>
      </Text>
      <Button asChild block>
        <Link href="/">{t("primaryAction")}</Link>
      </Button>
      <Button asChild variant="ghost" tone="accent" block>
        <Link href="/metas">{t("secondaryAction")}</Link>
      </Button>
    </Page>
  );
}
