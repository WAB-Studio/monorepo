import type { ReactNode } from "react";

import styles from "./page.module.css";

// The ground every screen stands on: one column, the phone's own gutter, and
// the room a home indicator takes under the last row.
//
// Beside the rail a screen without `width="full"` is a form: its header spans
// the frame and the fields sit in a 560px block under it. `width="full"` is
// for every screen that lays out its own columns or list, which take all the
// rail leaves.
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
  width?: "full";
  alone?: boolean;
  middle?: boolean;
}) {
  const cap = width === "full" ? styles.full : undefined;
  const className = [styles.page, cap, alone ? styles.alone : undefined, middle ? styles.middle : undefined]
    .filter(Boolean)
    .join(" ");
  return <main className={className}>{children}</main>;
}
