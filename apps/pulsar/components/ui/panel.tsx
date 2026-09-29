import type { ReactNode } from "react";

import styles from "./panel.module.css";

// The desktop card that groups one part of a screen (RNP-11): white ground,
// 1px line, radius 14. Below 1024px it draws nothing, so the phone face is the
// page's own column. Stack panels as siblings: consecutive ones sit 18px apart.
export function Panel({
  children,
  as: Tag = "section",
  row = false,
}: {
  children?: ReactNode;
  as?: "section" | "div";
  // From 1024px a plain row of its children, no card: a title beside its acts.
  row?: boolean;
}) {
  return <Tag className={row ? `${styles.panel} ${styles.row}` : styles.panel}>{children}</Tag>;
}
