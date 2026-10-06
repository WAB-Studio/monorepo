"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { Mark, Row, Text } from "@/components/ui";

import { OneOffDeleteSheet } from "./one-off-delete-sheet";
import { type MessageKey } from "@/i18n/translator";

export type OneOffRowProps = {
  oneOffId: string;
  name: string;
  // «del sábado 19»: set only on a one-off carried from a day before the one
  // drawn (RP-19), so today's own read with no second line.
  carriedFrom?: string;
};

/**
 * A plain errand beside the commitments (RP-19): the same mark, the same
 * 56 px row. Its mark is always drawn empty — there is nothing left to
 * distinguish once it is on the list, since `completeOneOff` is what takes
 * it off (`app/actions/one-offs.ts`), never a second state drawn here.
 *
 * Two tap targets, two acts (RP-22): the mark still finishes it
 * (`onLeadingClick`), the name opens the sheet that deletes it (`onClick`) —
 * `Row`'s own split, so neither tap reaches the other's act by mistake.
 */
export function OneOffRow({ oneOffId, name, carriedFrom }: OneOffRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function handleComplete() {
    if (pending) return;
    setError(null);

    startTransition(() => {
      void completeOneOff({ oneOffId }).then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

  return (
    <>
      <Row
        leading={<Mark state="empty" />}
        leadingLabel={t("day.oneOffs.markLabel")}
        name={name}
        meta={carriedFrom}
        onLeadingClick={handleComplete}
        onClick={() => setDeleteOpen(true)}
        disabled={pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
      <OneOffDeleteSheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        oneOffId={oneOffId}
        name={name}
      />
    </>
  );
}
