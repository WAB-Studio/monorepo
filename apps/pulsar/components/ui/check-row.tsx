import type { ChangeEvent, ReactNode } from "react";

import { Text } from "./text";
import styles from "./check-row.module.css";

// docs/pulsar/DESIGN.md "Importar": a row the person marks in or out, the
// review's one shape. The checkbox is the native one, so a reader and the
// keyboard get it whole.
export function CheckRow({
  checked,
  onCheckedChange,
  disabled,
  name,
  meta,
  reason,
  trailing,
  amount,
  amountLabel,
  onAmount,
  indent,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name: ReactNode;
  // The quiet line under the name.
  meta?: ReactNode;
  // A refusal's words, in ink under the meta.
  reason?: ReactNode;
  // Text at the end that opens nothing.
  trailing?: ReactNode;
  // An amount at the end that opens its edit; `amountLabel` names it for a reader.
  amount?: ReactNode;
  amountLabel?: string;
  onAmount?: () => void;
  // A sub-task sits 32px in.
  indent?: boolean;
}) {
  return (
    <label className={indent ? `${styles.row} ${styles.indent}` : styles.row}>
      <input
        type="checkbox"
        className={styles.box}
        checked={checked}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onCheckedChange?.(event.target.checked)}
      />
      <span className={styles.body}>
        <Text as="span" variant="body" tone={disabled && !checked && reason ? "quiet" : "ink"}>
          {name}
        </Text>
        {meta ? (
          <Text as="span" variant="meta" tone="quiet">
            {meta}
          </Text>
        ) : null}
        {reason ? <span className={styles.reason}>{reason}</span> : null}
      </span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
      {amount !== undefined && amount !== null ? (
        <button type="button" className={styles.amount} aria-label={amountLabel} onClick={onAmount} disabled={disabled}>
          {amount}
        </button>
      ) : null}
    </label>
  );
}

// The review's confirm, held at the foot above the nav.
export function ActionBar({ children }: { children?: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
