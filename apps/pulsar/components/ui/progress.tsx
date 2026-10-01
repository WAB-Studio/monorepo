import styles from "./progress.module.css";

// A thin bar of how much of a plan is reached, in ink on the line colour. It
// says nothing a sentence beside it does not, so a reader skips it.
export function Progress({ percent }: { percent: number }) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <span aria-hidden className={styles.track}>
      <span className={styles.fill} style={{ inlineSize: `${width}%` }} />
    </span>
  );
}
