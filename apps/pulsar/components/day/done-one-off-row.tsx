"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { undoFact } from "@/app/actions/facts";
import { Mark, Row, Text } from "@/components/ui";
import { type MessageKey } from "@/i18n/translator";

export type DoneOneOffRowProps = {
  factId: string;
  name: string;
  // The hour it was done, already said in the person's zone.
  time?: string;
};

/**
 * A one-off done today (RP-19): the whole row is the one control and takes
 * the fact back, so the one-off returns among the undone (RP-05). It opens
 * nothing — a done one-off is not deleted (RP-22).
 */
export function DoneOneOffRow({ factId, name, time }: DoneOneOffRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);

  function handleUndo() {
    if (pending) return;
    setError(null);

    startTransition(() => {
      void undoFact({ factId }).then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

  return (
    <>
      <Row
        leading={<Mark state="declared" />}
        aria-label={t("day.doneOneOffs.undoLabel", { name })}
        name={
          <Text as="span" tone="muted">
            {name}
          </Text>
        }
        meta={time}
        onClick={handleUndo}
        disabled={pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
    </>
  );
}
