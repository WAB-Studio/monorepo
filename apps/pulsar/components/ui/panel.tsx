import type { ReactNode } from "react";

import styles from "./panel.module.css";

// The desktop card that groups one part of a screen (RNP-11): white ground,
// 1px line, radius 14. Below 1024px it draws nothing, so the phone face is the
// page's own column. Stack panels as siblings: consecutive ones sit 18px apart.
export function Panel({
  children,
  as: Tag = "section",
  row = false,
  bordered = false,
  stacked = false,
  label,
}: {
  children?: ReactNode;
  as?: "section" | "div";
  // From 1024px a plain row of its children, no card: a title beside its acts.
  row?: boolean;
  // A box at every width, for a note that stands apart on the phone too.
  bordered?: boolean;
  // A plain block on the phone, its rows touching, so the phone face keeps its
  // own stacking; from 1024px the card, without the gap between rows.
  stacked?: boolean;
  label?: string;
}) {
  const className = [
    styles.panel,
    row ? styles.row : undefined,
    bordered ? styles.bordered : undefined,
    stacked ? styles.stacked : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={className} aria-label={label}>
      {children}
    </Tag>
  );
}

// Cards side by side from 1024px, tops aligned, two columns or three (the
// report); below, the children stay the parent's own items.
export function PanelGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={columns === 3 ? `${styles.grid} ${styles.three}` : styles.grid}>{children}</div>;
}
