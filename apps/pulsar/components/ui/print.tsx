import type { ReactNode } from "react";

import styles from "./print.module.css";

// The printed face of a page (RP-46, `ReporteImpreso.dc.html`): the export is
// the page the browser prints, so all of it is CSS under `@media print` and
// none of it runs. On screen the frame is invisible.
export function PrintPage({ children }: { children?: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

// A block the printer keeps whole where it fits: wrap a goal's section in one. It sets no style on screen.
export function PrintBlock({ children }: { children?: ReactNode }) {
  return <section className={styles.block}>{children}</section>;
}

// Gone on screen, shown in print: the head's brand and dated year.
export function PrintOnly({ children }: { children?: ReactNode }) {
  return <div className={styles.only}>{children}</div>;
}

// Shown on screen, gone in print: the button that calls `window.print()`.
export function PrintHidden({ children }: { children?: ReactNode }) {
  return <div className={styles.hidden}>{children}</div>;
}
