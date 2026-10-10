import type { ReactNode } from "react";

import styles from "./notice.module.css";

// docs/pulsar/DESIGN.md "Importar": a refusal the person must read, as a
// white box with a 1.5px ink ring — this design has no colour for failure.
// `note` is a line to read where it stands, not announced as a failure.
// `title` and `rows` list several things at once: a bold line, then one row each, a rule between.
export function Notice({
  children,
  role = "alert",
  title,
  rows,
}: {
  children?: ReactNode;
  role?: "alert" | "note";
  title?: string;
  rows?: string[];
}) {
  return (
    <div role={role} className={styles.notice}>
      {title ? <strong className={styles.title}>{title}</strong> : null}
      {rows?.map((row, index) => (
        <p key={index} className={styles.row}>
          {row}
        </p>
      ))}
      {children}
    </div>
  );
}
