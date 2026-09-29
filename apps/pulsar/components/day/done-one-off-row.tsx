"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { undoFact } from "@/app/actions/facts";
import { Mark, Row, Text } from "@/components/ui";

export type DoneOneOffRowProps = {
  factId: string;
  name: string;
};

/**
 * A one-off done today (RP-19): the filled mark is the one control and takes
 * the fact back, so the one-off returns among the undone (RP-05). Its name
 * opens nothing — a done one-off is not deleted (RP-22).
 */
export function DoneOneOffRow({ factId, name }: DoneOneOffRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
        leadingLabel={t("day.doneOneOffs.undoLabel", { name })}
        name={
          <Text as="span" tone="muted">
            {name}
          </Text>
        }
        onLeadingClick={handleUndo}
        tabIndex={-1}
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
