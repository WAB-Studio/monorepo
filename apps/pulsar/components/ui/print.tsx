import type { ReactNode } from "react";

import styles from "./print.module.css";

// The printed face of a page (RP-49, `ReporteImpreso.dc.html`): the export is
// the page the browser prints, so all of it is CSS under `@media print` and
// none of it runs. On screen the frame is invisible.
export function PrintPage({ children }: { children?: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

// A block on paper. It sets no style on screen.
// `span` keeps the block across every column of a `PrintGoal`; `lead` also keeps it with the block after it.
// `whole` keeps it on one page; a block taller than a page still breaks.
export function PrintBlock({
  children,
  span,
  whole,
}: {
  children?: ReactNode;
  span?: "all" | "lead";
  whole?: boolean;
}) {
  const classes = [styles.block];
  if (span) classes.push(styles.all);
  if (span === "lead") classes.push(styles.lead);
  if (whole) classes.push(styles.whole);
  return <section className={classes.join(" ")}>{children}</section>;
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
