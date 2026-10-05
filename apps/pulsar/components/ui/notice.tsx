import type { ReactNode } from "react";

import styles from "./notice.module.css";

// docs/pulsar/DESIGN.md "Importar": a refusal the person must read, as a
// white box with a 1.5px ink ring — this design has no colour for failure.
// `note` is a line to read where it stands, not announced as a failure.
export function Notice({ children, role = "alert" }: { children?: ReactNode; role?: "alert" | "note" }) {
  return (
    <div role={role} className={styles.notice}>
      {children}
    </div>
  );
}
