import type { CSSProperties, ReactNode } from "react";

import styles from "./field-pair.module.css";

// Two fields side by side, 8px apart. `narrow` sizes the first one in pixels
// (a quantity beside its unit) and the second takes the rest; without it the
// two share the width evenly.
export function FieldPair({ narrow, children }: { narrow?: number; children: ReactNode }) {
  return (
    <div
      className={[styles.pair, narrow ? styles.narrow : undefined].filter(Boolean).join(" ")}
      style={narrow ? ({ "--pair-narrow": `${narrow}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
