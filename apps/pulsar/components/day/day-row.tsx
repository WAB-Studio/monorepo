"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact } from "@/app/actions/facts";
import { Figure, Mark, Row, Text, type MarkState } from "@/components/ui";

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
  // The plan's own number and unit for a `quantity` row (RP-03): null for
  // every other kind, which needs neither.
  target?: number | null;
  unit?: string | null;
};

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
}: DayRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const tappable = kind !== "evidence";

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
        meta={sourceName}
        trailing={
          kind === "quantity" && target != null ? (
            <Figure value={target} unit={unit ?? undefined} variant="meta" />
          ) : undefined
        }
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
