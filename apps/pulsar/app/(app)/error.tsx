"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button, Page, Text } from "@/components/ui";

/**
 * `Fallo.dc.html` (RNP-01). `app/(app)/layout.tsx` still renders above this
 * boundary — `node_modules/next/dist/docs/.../file-conventions/error.md`:
 * an `error.js` wraps its own segment's children, never the layout that owns
 * it — so the nav that layout already draws keeps drawing here, with
 * whatever tab the crashed path itself carries; no second one is written by
 * hand.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const t = useTranslations("common.error");

  return (
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
      <Button block onClick={() => retry()}>
        {t("retry")}
      </Button>
      <Button asChild variant="ghost" tone="accent" block>
        <Link href="/">{t("secondaryAction")}</Link>
      </Button>
    </Page>
  );
}
