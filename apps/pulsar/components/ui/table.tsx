import type { ReactNode } from "react";

import { formatFigureValue } from "./format-figure";
import styles from "./table.module.css";

// docs/pulsar/DESIGN.md, the review (RP-17): one set of props, two faces. The
// phone draws `Revision.dc.html`'s stack of ruled rows; past the kit's 700px
// breakpoint the same rows become `RevisionEscritorio.dc.html`'s real
// `<table>`. Both are always in the markup and CSS shows one, so a screen
// never switches markup itself.
export type TableRow = {
  key: string;
  // One per column, in `columns`' order. In a figure column, `null` or
  // `undefined` is a week not yet reached and draws «—».
  cells: readonly ReactNode[];
  // The phone face's trailing note: the wide face spreads it over columns
  // the phone has no room for, so the caller words it once for the phone.
  note?: ReactNode;
  // A second line under the row label, on both faces: the week's dates.
  detail?: ReactNode;
};

type TableProps = {
  // The phone's caption above the stack; the wide table's accessible name.
  caption: string;
  // Header strings, wide face. Column 0 is the row label on both faces.
  columns: readonly string[];
  rows: readonly TableRow[];
  // Indexes into `columns` set as figures. The first is the one figure the
  // phone shows and the one the wide face sets at the measure's size.
  figures?: readonly number[];
  // Beside the phone's figure; the wide face names it in its header.
  unit?: string;
  // Index into `rows`. Marked `data-current` only: the boards draw the
  // current week by its note alone, never by a fill or a weight.
  current?: number;
};

function isEmpty(cell: ReactNode): boolean {
  return cell === null || cell === undefined;
}

function figureCell(cell: ReactNode): ReactNode {
  return isEmpty(cell) ? <span className={styles.pending}>—</span> : formatFigureValue(cell);
}

export function Table({ caption, columns, rows, figures = [], unit, current }: TableProps) {
  const lead = figures[0];
  const last = columns.length - 1;

  const cellClass = (column: number): string => {
    if (column === 0) return styles.label;
    if (column === lead) return styles.lead;
    if (figures.includes(column)) return styles.figure;
    return column === last ? styles.note : styles.text;
  };

  // The board sizes each column by its role; the last one takes what is left.
  const widthClass = (column: number): string | undefined => {
    if (column === last) return undefined;
    if (column === 0) return styles.labelWidth;
    if (column === lead) return styles.leadWidth;
    if (figures.includes(column)) return styles.figureWidth;
    return styles.textWidth;
  };

  const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");

  return (
    <div className={styles.table}>
      <div className={styles.phone}>
        <span className={styles.caption}>{caption}</span>
        <ol className={styles.stack}>
          {rows.map((row, index) => (
            <li
              key={row.key}
              className={styles.stackRow}
              data-current={index === current ? "" : undefined}
            >
              <span className={styles.stackLabel}>
                {row.cells[0]}
                {row.detail ? <span className={styles.detail}>{row.detail}</span> : null}
              </span>
              {lead === undefined ? null : (
                <span className={styles.stackFigure}>
                  {figureCell(row.cells[lead])}
                  {unit && !isEmpty(row.cells[lead]) ? (
                    <span className={styles.unit}>{unit}</span>
                  ) : null}
                </span>
              )}
              {row.note ? <span className={styles.stackNote}>{row.note}</span> : null}
            </li>
          ))}
        </ol>
      </div>

      <table className={styles.wide}>
        <caption className={styles.hidden}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((header, column) => (
              <th key={column} scope="col" className={join(styles.header, widthClass(column))}>
                {header}
                {column === lead && unit ? <span className={styles.headerUnit}>{unit}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} data-current={index === current ? "" : undefined}>
              {columns.map((_, column) => (
                <td key={column} className={join(styles.cell, cellClass(column))}>
                  {figures.includes(column) ? figureCell(row.cells[column]) : row.cells[column]}
                  {column === 0 && row.detail ? (
                    <span className={styles.detailWide}>{row.detail}</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
