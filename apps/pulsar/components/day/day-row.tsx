"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact, undoFact } from "@/app/actions/facts";
import type { Cadence } from "@/lib/day/types";
import { Mark, Row, Text, type MarkState } from "@/components/ui";

import { QuantitySheet } from "./quantity-sheet";

export type DayRowKind = "tap" | "quantity" | "evidence";

export type DayRowProps = {
  commitmentId: string;
  name: string;
  // What satisfies the commitment (RP-02, RP-03, RP-07): a `tap` row calls
  // `declareFact` outright, an `evidence` row never calls it at all — RP-07
  // says evidence takes no act from the person — and a `quantity` row opens
  // module 14's sheet.
  kind: DayRowKind;
  markState: MarkState;
  // The evidence catalogue's own name for the source, shown only once this
  // row is actually satisfied by it (RP-09): before that there is nothing
  // yet to attribute to a source.
  sourceName?: string;
  // The plan's own number, unit and cadence for a `quantity` row (RP-03):
  // null for every other kind, which needs none of them.
  target?: number | null;
  unit?: string | null;
  cadence?: Cadence;
  // Today's own fact for this commitment, the most recent one when more than
  // one landed (`lib/queries/day.ts`'s `LoggedFact`) — undefined while the
  // row is still empty, which is exactly when there is nothing to undo yet.
  factId?: string;
  // What a `quantity` commitment actually logged, read back rather than the
  // plan's own target (RP-04's own "a done row shows what was logged").
  loggedQuantity?: number | null;
  // The line the person wrote alongside the fact (RP-04), drawn quiet under
  // the row when there is one.
  note?: string | null;
  // The past day this row stands on (RP-06): every fact it writes names that
  // day. Absent on Hoy, where the action decides today itself.
  day?: string;
  // «anotado el lunes 21», set only when the fact was written on a later day
  // than the one drawn: the day it counts for and the day it was written are
  // never read as one (RP-06).
  writtenLabel?: string;
};

// The row's own mono second line for a `quantity` commitment — `HoyCantidad
// .dc.html` draws "10 min · diario" under the name. `unit` is read as the
// commitment's own word (`goals.commitments.unit`, e.g. "minutos"), not
// abbreviated to the board's "min": there is no table mapping an arbitrary
// unit string to a short form, and guessing one would be a second unit the
// person never typed.
function quantityMeta(target: number, unit: string, cadence: Cadence, t: ReturnType<typeof useTranslations>): string {
  return `${target} ${unit} · ${cadenceLabel(cadence, t)}`;
}

// A done row's own second line (decided 2026-09-27, `docs/pulsar/DESIGN.md`
// "Decisions taken here"): what the person actually logged, never the plan's
// target — "25 minutos", not "10 minutos · diario".
function loggedMeta(quantity: number, unit: string): string {
  return `${quantity} ${unit}`;
}

function cadenceLabel(cadence: Cadence, t: ReturnType<typeof useTranslations>): string {
  switch (cadence.kind) {
    case "daily":
      return t("day.cadence.daily");
    case "weekdays": {
      const names = t.raw("day.cadence.weekdayShort") as string[];
      return cadence.days.map((day) => names[day - 1]).join(", ");
    }
    case "times_per_week":
      return t("day.cadence.timesPerWeek", { count: cadence.count });
    case "every_n_days":
      // "Every 1 day" reads exactly as daily; nothing distinguishes them on
      // screen (RP-12 anchors `every_n_days` to `created_at`, not to a
      // visible span, so there is nothing else to say about `n === 1`).
      return cadence.n === 1 ? t("day.cadence.daily") : t("day.cadence.everyNDays", { n: cadence.n });
    case "times_per_month":
      return t("day.cadence.timesPerMonth", { count: cadence.count });
  }
}

/**
 * One commitment's row (RP-01, RP-02, RP-05, RP-08). A `tap` commitment is
 * satisfied outright, and a second tap on a done one undoes it through
 * `undoFact` — the same gesture that made it unmakes it, no confirm sheet
 * (RP-05, decided 2026-09-27). A `quantity` row's tap always opens
 * `QuantitySheet`, done or not: calling `declareFact` bare would only ever
 * come back `day.errors.quantityRequired`, and a done row needs the sheet
 * anyway to show what it logged and offer `Deshacer`. An `evidence` row is
 * never tappable at all, satisfied or not: nothing here calls `declareFact`
 * or `undoFact` for it (RP-05: a derived fact belongs to the app that
 * recorded it).
 */
export function DayRow({
  commitmentId,
  name,
  kind,
  markState,
  sourceName,
  target,
  unit,
  cadence,
  factId,
  loggedQuantity,
  note,
  day,
  writtenLabel,
}: DayRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const tappable = kind !== "evidence";
  const done = markState === "declared";
  const baseMeta =
    kind === "quantity"
      ? done && loggedQuantity != null && unit != null
        ? loggedMeta(loggedQuantity, unit)
        : target != null && unit != null && cadence
          ? quantityMeta(target, unit, cadence, t)
          : sourceName
      : sourceName;
  const meta = [baseMeta, writtenLabel].filter(Boolean).join(" · ") || undefined;

  function handleTap() {
    if (!tappable || pending) return;
    setError(null);

    if (kind === "quantity") {
      setSheetOpen(true);
      return;
    }

    startTransition(() => {
      // Done already: this tap undoes it, never declares a second fact
      // beside it (the bug the critic measured 2026-09-27).
      const action = done && factId ? undoFact({ factId }) : declareFact({ commitmentId, day });
      void action.then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

  return (
    <>
      <Row
        leading={<Mark state={markState} />}
        name={name}
        meta={meta}
        onClick={handleTap}
        disabled={!tappable || pending}
      />
      {note ? (
        <Text as="p" tone="quiet" variant="meta">
          {note}
        </Text>
      ) : null}
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
      {kind === "quantity" ? (
        <QuantitySheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          commitmentId={commitmentId}
          name={name}
          target={target ?? 0}
          unit={unit ?? ""}
          factId={done ? factId : undefined}
          loggedQuantity={done ? loggedQuantity : undefined}
          loggedNote={done ? note : undefined}
          day={day}
        />
      ) : null}
    </>
  );
}
