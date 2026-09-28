import type { ReactNode } from "react";

import styles from "./page.module.css";

// The ground every screen stands on: one column, the phone's own gutter, and
// the room a home indicator takes under the last row. No screen sets a width
// but the review's own (RP-17): `width="wide"` lifts the wide cap from 640 to
// 1020, the one span `RevisionEscritorio.dc.html` draws — "A wide face beyond
// `RevisionEscritorio.dc.html`" is the only one this design has (docs/pulsar/
// DESIGN.md "The boards that do not exist"), so no third value is offered.
export function Page({ children, width }: { children?: ReactNode; width?: "wide" }) {
  return <main className={width === "wide" ? `${styles.page} ${styles.wide}` : styles.page}>{children}</main>;
}
