"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { Text } from "./text";
import styles from "./row.module.css";

// docs/pulsar/DESIGN.md: a row is a real `<button>`, never a div, at least 56px
// tall, ruled from the next by a hairline. Never a card, never a border box.
// Writing a fact costs one tap, so the whole row is the target (RNP-02).
type RowProps = Omit<ComponentPropsWithoutRef<"button">, "children" | "name"> & {
  // What sits at the head of the row — usually the mark, sometimes a plain
  // label (`Semana.dc.html`'s own day row has no mark of its own to lead
  // with).
  leading?: ReactNode;
  // The row's own display name — never the native `<button name>` form
  // attribute, which this type deliberately excludes above: nothing in this
  // app submits a row as a form control, and a `ReactNode` here (module 17's
  // own dot grid, not just a string) would otherwise collide with it.
  name: ReactNode;
  // The line under the name: mono, muted, a date or a count.
  meta?: ReactNode;
  // What sits at the end — a measure, a chevron.
  trailing?: ReactNode;
  // Drops the hairline for the last row of a group, where the group's own
  // spacing already separates it.
  rule?: boolean;
  // Splits the row into two real buttons — the leading mark and the rest —
  // for a row whose mark does a different act than its name
  // (`one-off-row.tsx`'s mark still finishes it; its name opens the sheet
  // that deletes it, RP-22). Absent, the row stays the one button it always
  // was. Names the mark's own button for a reader that has no visible text
  // to read there.
  onLeadingClick?: () => void;
  leadingLabel?: string;
};

export const Row = forwardRef<HTMLButtonElement, RowProps>(function Row(
  {
    leading,
    name,
    meta,
    trailing,
    rule = true,
    onLeadingClick,
    leadingLabel,
    className,
    type = "button",
    disabled,
    onClick,
    ...props
  },
  ref,
) {
  const merged = [
    styles.row,
    rule ? undefined : styles.flush,
    onLeadingClick ? styles.split : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <span className={styles.body}>
        <Text as="span" variant="name">
          {name}
        </Text>
        {meta ? (
          <Text as="span" variant="meta">
            {meta}
          </Text>
        ) : null}
      </span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </>
  );

  if (onLeadingClick) {
    return (
      <div className={merged}>
        {leading ? (
          <button
            type="button"
            className={styles.leadingButton}
            onClick={onLeadingClick}
            disabled={disabled}
            aria-label={leadingLabel}
          >
            {leading}
          </button>
        ) : null}
        <button
          ref={ref}
          type={type}
          className={styles.bodyButton}
          onClick={onClick}
          disabled={disabled}
          {...props}
        >
          {body}
        </button>
      </div>
    );
  }

  return (
    <button ref={ref} type={type} className={merged} disabled={disabled} onClick={onClick} {...props}>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      {body}
    </button>
  );
});
