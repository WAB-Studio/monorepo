"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact } from "@/app/actions/facts";
import { Mark, Row, Text, type MarkState } from "@/components/ui";

export type DayRowKind = "tap" | "quantity" | "evidence";

export type DayRowProps = {
  commitmentId: string;
  name: string;
  // What satisfies the commitment (RP-02, RP-03, RP-07): a `tap` row calls
  // `declareFact` outright, an `evidence` row never calls it at all — RP-07
  // says evidence takes no act from the person — and a `quantity` row opens
  // module 14's sheet, not built yet (see `openQuantitySheetPlaceholder`).
  kind: DayRowKind;
  markState: MarkState;
  // The evidence catalogue's own name for the source, shown only once this
  // row is actually satisfied by it (RP-09): before that there is nothing
  // yet to attribute to a source.
  sourceName?: string;
};

/**
 * One commitment's row (RP-01, RP-02, RP-08). A `tap` commitment is
 * satisfied outright; a `quantity` row's tap is wired to
 * `openQuantitySheetPlaceholder` until module 14 lands, never to
 * `declareFact` bare — that would only ever come back
 * `day.errors.quantityRequired`, a dead end dressed as a working button. An
 * `evidence` row is never tappable at all, satisfied or not: nothing here
 * calls `declareFact` for it.
 */
export function DayRow({ commitmentId, name, kind, markState, sourceName }: DayRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tappable = kind !== "evidence";

  function handleTap() {
    if (!tappable || pending) return;
    setError(null);

    if (kind === "quantity") {
      openQuantitySheetPlaceholder();
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
        onClick={handleTap}
        disabled={!tappable || pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
    </>
  );
}

// Module 14's `components/day/quantity-sheet.tsx` replaces this call: a
// `quantity` row stays a real, working button meanwhile, and tapping it does
// nothing rather than crashing or firing a request the server can only
// refuse.
function openQuantitySheetPlaceholder(): void {}
