import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button, Page, Text } from "@/components/ui";

import styles from "./consent.module.css";

// No button that approves: a request that cannot be trusted has nothing to grant.
export function Invalid() {
  const t = useTranslations("oauth");

  return (
    <Page>
      <div className={`${styles.list} ${styles.centred}`}>
        <Text as="p" variant="meta" tone="muted">
          {t("eyebrow")}
        </Text>
        <Text asChild variant="title">
          <h1>{t("invalid.title")}</h1>
        </Text>
        <Text as="p">{t("invalid.body")}</Text>
      </div>
      <Button asChild variant="outline" tap={52} block>
        <Link href="/">{t("invalid.home")}</Link>
      </Button>
    </Page>
  );
}
