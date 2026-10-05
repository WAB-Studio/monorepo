import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Text } from "./text";
import styles from "./screen-header.module.css";

// `ArmazonEncabezado.dc.html`: the one header every screen draws. The title is
// the page's only `h1`; the way back is a chevron and the place's name, 48px,
// its accessible name «Volver a {place}». Nothing in it is sticky.
export function ScreenHeader({
  title,
  back,
  eyebrow,
  actions,
  meta,
}: {
  title: string;
  back?: { href: string; place: string };
  // A section label, or an accent link, between the way back and the title.
  eyebrow?: ReactNode;
  // Beside the title from 1024, under it below.
  actions?: ReactNode;
  // One mono line under the title.
  meta?: string;
}) {
  const t = useTranslations("common");

  return (
    <header className={styles.header}>
      {back ? (
        <Link
          href={back.href}
          className={styles.back}
          aria-label={t("header.back", { place: back.place })}
        >
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          <span>{back.place}</span>
        </Link>
      ) : null}
      {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
      <div className={styles.line}>
        <Text asChild variant="title">
          <h1 className={styles.title}>{title}</h1>
        </Text>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {meta ? (
        <Text as="p" variant="meta" tone="muted" className={styles.meta}>
          {meta}
        </Text>
      ) : null}
    </header>
  );
}
