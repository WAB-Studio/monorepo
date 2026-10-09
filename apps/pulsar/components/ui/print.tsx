import type { ReactNode } from "react";

import styles from "./print.module.css";

// The printed face of a page (RP-49, `ReporteImpreso.dc.html`): the export is
// the page the browser prints, so all of it is CSS under `@media print` and
// none of it runs. On screen the frame is invisible.
export function PrintPage({ children }: { children?: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

// A block the printer keeps whole where it fits: wrap a goal's section in one. It sets no style on screen.
// `span` keeps the block across every column of a `PrintGoal`; `lead` also keeps it with the block after it.
export function PrintBlock({ children, span }: { children?: ReactNode; span?: "all" | "lead" }) {
  const className =
    span === "lead" ? `${styles.block} ${styles.all} ${styles.lead}` : span === "all" ? `${styles.block} ${styles.all}` : styles.block;
  return <section className={className}>{children}</section>;
}

// A goal's blocks: a column on screen, two columns on paper (`ReporteImpresoCompacto.dc.html`).
export function PrintGoal({ children }: { children?: ReactNode }) {
  return <div className={styles.goal}>{children}</div>;
}

// Gone on screen, shown in print: the head's brand and dated year.
export function PrintOnly({ children }: { children?: ReactNode }) {
  return <div className={styles.only}>{children}</div>;
}

// Shown on screen, gone in print: the button that calls `window.print()`.
export function PrintHidden({ children }: { children?: ReactNode }) {
  return <div className={styles.hidden}>{children}</div>;
}
