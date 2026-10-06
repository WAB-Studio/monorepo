import type { ReactNode } from "react";

import { SectionLabel } from "./section-label";
import styles from "./section.module.css";

// docs/pulsar/DESIGN.md "Decisions of 2026-10-06": a section carries its own
// label→content gap. The gap to the next section is the parent's `gap`, so a
// screen never spaces sections with a margin.
export function Section({
  label,
  as: Tag = "section",
  children,
}: {
  label?: ReactNode;
  as?: "section" | "div";
  children?: ReactNode;
}) {
  return (
    <Tag className={styles.section}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      {children}
    </Tag>
  );
}
