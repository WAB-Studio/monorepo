import type { ReactNode } from "react";

import styles from "./split.module.css";

// The desktop screen's two columns (RNP-11): `main` on the left, `before` over
// `after` on the right. Below 1024px the three parts are plain siblings in the
// page's own column, in the order `before`, `main`, `after`.
export function Split({
  main,
  before,
  after,
  aside = 360,
}: {
  main: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  // The right column's width: Hoy draws 360, the goal 380.
  aside?: 360 | 380;
}) {
  const className = [
    styles.split,
    aside === 380 ? styles.asideWide : undefined,
    before ? undefined : styles.noBefore,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      {before ? <div className={styles.before}>{before}</div> : null}
      <div className={styles.main}>{main}</div>
      {after ? <div className={styles.after}>{after}</div> : null}
    </div>
  );
}
