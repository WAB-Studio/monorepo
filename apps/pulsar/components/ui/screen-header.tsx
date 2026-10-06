import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { SectionLabel } from "./section-label";
import { Skeleton } from "./skeleton";
import { Text } from "./text";
import styles from "./screen-header.module.css";

// `ArmazonEncabezado.dc.html`: the one header every screen draws. The title is
// the page's only `h1`; the way back is a chevron and the place's name, 48px,
// its accessible name «Volver a {place}». Nothing in it is sticky.
export function ScreenHeader({
  title,
  back,
  eyebrow,
  eyebrowHref,
  controls,
  actions,
  meta,
}: {
  title: string;
  back?: { href: string; place: string };
  // A string is drawn in the one eyebrow style. A node is drawn as given.
  eyebrow?: ReactNode;
  // Makes a string eyebrow an accent link.
  eyebrowHref?: string;
  // A row on the eyebrow's line: the steps, the way back, the theme toggle.
  controls?: ReactNode;
  // Beside the title from 1024, under it below.
  actions?: ReactNode;
  // One mono line under the title.
  meta?: string;
}) {
  const t = useTranslations("common");
  const eyebrowNode =
    typeof eyebrow !== "string" ? (
      eyebrow
    ) : !eyebrow ? null : eyebrowHref ? (
      <Link href={eyebrowHref} className={styles.eyebrowLink}>
        {eyebrow}
      </Link>
    ) : (
      <SectionLabel>{eyebrow}</SectionLabel>
    );

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
      {controls ? (
        <div className={styles.top}>
          {eyebrowNode ? <div className={styles.eyebrow}>{eyebrowNode}</div> : null}
          <div className={styles.controls}>{controls}</div>
        </div>
      ) : eyebrowNode ? (
        <div className={styles.eyebrow}>{eyebrowNode}</div>
      ) : null}
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

// The header while its screen loads: the way back and the title as blocks, in
// the header's own height, so the content does not jump when the real one lands.
export function ScreenHeaderSkeleton() {
  return (
    <header aria-hidden className={styles.header}>
      <span className={styles.backSkeleton}>
        <Skeleton shape="meta" />
      </span>
      <div className={styles.titleSkeleton}>
        <Skeleton shape="title" width="half" />
      </div>
    </header>
  );
}

// What a screen that has nothing to show says and offers
// (`ArmazonFallo.dc.html`, `ArmazonNoEncontrada.dc.html`): an optional line and
// its exits, stacked full width on the phone, a row capped at 560px from 1024.
export function ScreenExit({ message, children }: { message?: string; children: ReactNode }) {
  return (
    <div className={styles.exit}>
      {message ? (
        <Text as="p" tone="secondary">
          {message}
        </Text>
      ) : null}
      <div className={styles.exitActions}>{children}</div>
    </div>
  );
}
