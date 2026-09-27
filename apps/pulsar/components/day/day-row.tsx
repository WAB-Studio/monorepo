"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact } from "@/app/actions/facts";
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
 * One commitment's row (RP-01, RP-02, RP-08). A `tap` commitment is
 * satisfied outright; a `quantity` row's tap opens `QuantitySheet` rather
 * than calling `declareFact` bare — that would only ever come back
 * `day.errors.quantityRequired`, a dead end dressed as a working button. An
 * `evidence` row is never tappable at all, satisfied or not: nothing here
 * calls `declareFact` for it.
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
}: DayRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const tappable = kind !== "evidence";
  const meta =
    kind === "quantity" && target != null && unit != null && cadence
      ? quantityMeta(target, unit, cadence, t)
      : sourceName;

  function handleTap() {
    if (!tappable || pending) return;
    setError(null);

    if (kind === "quantity") {
      setSheetOpen(true);
      return;
    }

    startTransition(() => {
      void declareFact({ commitmentId }).then((result) => {
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
        />
      ) : null}
    </>
  );
}
