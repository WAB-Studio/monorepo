import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BottomNav, Button, Page, Text } from "@/components/ui";

/**
 * `NoEncontrada.dc.html` (RNP-01). Reached two ways
 * (`node_modules/next/dist/docs/.../file-conventions/not-found.md`): a
 * `notFound()` thrown anywhere with no nearer boundary — an archived goal's
 * own phase or commitment door, `archivar.spec.ts` — and any URL this app
 * does not route at all, `/no-existe` included. Outside `app/(app)/
 * layout.tsx`, so the nav it usually draws is written here by hand; this
 * page's own path never matches `/`, `/semana` or `/metas`, so no tab reads
 * active without any extra wiring.
 */
export default async function NotFound() {
  const t = await getTranslations("common.notFound");
  const nav = await getTranslations("common.nav");

  return (
    <>
      <Page>
        <Text as="p" variant="meta" tone="muted">
          {t("kicker")}
        </Text>
        <Text asChild variant="title">
          <h1>{t("title")}</h1>
        </Text>
        <Text as="p" tone="secondary">
          {t("body")}
        </Text>
        <Button asChild block>
          <Link href="/">{t("primaryAction")}</Link>
        </Button>
        <Button asChild variant="ghost" tone="accent" block>
          <Link href="/metas">{t("secondaryAction")}</Link>
        </Button>
      </Page>
      <BottomNav todayLabel={nav("today")} weekLabel={nav("week")} goalLabel={nav("goal")} />
    </>
  );
}
