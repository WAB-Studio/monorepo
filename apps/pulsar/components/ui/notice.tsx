import type { ReactNode } from "react";

import styles from "./notice.module.css";

// docs/pulsar/DESIGN.md "Importar": a refusal the person must read, as a
// white box with a 1.5px ink ring — this design has no colour for failure.
export function Notice({ children }: { children?: ReactNode }) {
  return (
    <div role="alert" className={styles.notice}>
      {children}
    </div>
  );
}
