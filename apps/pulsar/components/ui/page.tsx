import type { ReactNode } from "react";

import styles from "./page.module.css";

// The ground every screen stands on: one column, the phone's own gutter, and
// the room a home indicator takes under the last row. No screen sets a width
// but the review's own (RP-17): `width="wide"` lifts the wide cap from 640 to
// 1020, the one span `RevisionEscritorio.dc.html` draws — "A wide face beyond
// `RevisionEscritorio.dc.html`" is the only one this design has (docs/pulsar/
// DESIGN.md "The boards that do not exist"), so no third value is offered.
//
// Beside the rail a screen is one 640px column unless it says otherwise:
// `width="full"` is for the screens that lay out two columns of their own
// (Hoy, the goal, Semana's table), which take all the rail leaves.
//
// `alone` is a screen outside the shell, with no rail beside it (the consent
// screen): from 1024 its 640px column stays centred at the phone's padding.
// `middle` centres the column's content vertically on a screen that has one
// thing to say.
export function Page({
  children,
  width,
  alone,
  middle,
}: {
  children?: ReactNode;
  width?: "wide" | "full";
  alone?: boolean;
  middle?: boolean;
}) {
  const cap = width === "wide" ? styles.wide : width === "full" ? styles.full : undefined;
  const className = [styles.page, cap, alone ? styles.alone : undefined, middle ? styles.middle : undefined]
    .filter(Boolean)
    .join(" ");
  return <main className={className}>{children}</main>;
}
