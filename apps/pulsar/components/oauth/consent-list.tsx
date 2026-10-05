import { SectionLabel, Text } from "@/components/ui";

import styles from "./consent.module.css";

export function ConsentList({
  label,
  items,
  mark,
  tone,
}: {
  label: string;
  items: string[];
  mark: string;
  tone?: "muted";
}) {
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item} className={styles.item}>
            <span className={styles.mark} aria-hidden>
              {mark}
            </span>
            <Text tone={tone}>{item}</Text>
          </li>
        ))}
      </ul>
    </section>
  );
}
