import Link from "next/link";
import { Fragment } from "react";

import type { MarkState } from "./mark";
import styles from "./week-table.module.css";

export type WeekTableColumn = {
  key: string;
  label: string;
  // A column with `href` is a link in its header; `hrefLabel` names it.
  href?: string;
  hrefLabel?: string;
  today?: boolean;
};

export type WeekTableCell = { state: MarkState; label: string };

// `SemanaEscritorio.dc.html`: commitments down, days across. A `null` cell is
// a day nothing asked for; it draws a quiet dot and holds no text.
export function WeekTable({
  caption,
  columns,
  groups,
  footer,
}: {
  caption: string;
  columns: readonly WeekTableColumn[];
  groups: readonly {
    key: string;
    label: string;
    rows: readonly { key: string; name: string; cells: readonly (WeekTableCell | null)[] }[];
  }[];
  footer?: { label: string; cells: readonly string[] };
}) {
  const shade = (column: number) => (columns[column]?.today ? styles.today : undefined);
  const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");

  return (
    <table className={styles.table}>
      <caption className={styles.hidden}>{caption}</caption>
      <thead>
        <tr>
          <td className={styles.nameColumn} />
          {columns.map((column, index) => (
            <th key={column.key} scope="col" className={join(styles.day, shade(index), styles.head)}>
              {column.href ? (
                <Link href={column.href} aria-label={column.hrefLabel} className={styles.dayLink}>
                  {column.label}
                </Link>
              ) : (
                column.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <tr>
              <th scope="rowgroup" className={styles.group}>
                {group.label}
              </th>
              {columns.map((column, index) => (
                <td key={column.key} className={join(styles.gap, shade(index))} />
              ))}
            </tr>
            {group.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={styles.name}>
                  {row.name}
                </th>
                {columns.map((column, index) => {
                  const cell = row.cells[index] ?? null;
                  return (
                    <td key={column.key} className={join(styles.cell, shade(index))}>
                      {cell ? (
                        <span
                          className={join(styles.dot, styles[cell.state])}
                          role="img"
                          aria-label={cell.label}
                          data-state={cell.state}
                        />
                      ) : (
                        <span className={styles.none} aria-hidden />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
      {footer ? (
        <tfoot>
          <tr>
            <th scope="row" className={styles.footLabel}>
              {footer.label}
            </th>
            {columns.map((column, index) => (
              <td key={column.key} className={join(styles.footCell, shade(index))}>
                {footer.cells[index]}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
