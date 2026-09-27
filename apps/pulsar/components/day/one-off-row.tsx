"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { Mark, Row, Text } from "@/components/ui";

export type OneOffRowProps = {
  oneOffId: string;
  name: string;
};

/**
 * A plain errand beside the commitments (RP-19): the same mark, the same
 * 56 px row. Its mark is always drawn empty — there is nothing left to
 * distinguish once it is on the list, since `completeOneOff` is what takes
 * it off (`app/actions/one-offs.ts`), never a second state drawn here.
 */
export function OneOffRow({ oneOffId, name }: OneOffRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTap() {
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
      <Row leading={<Mark state="empty" />} name={name} onClick={handleTap} disabled={pending} />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
    </>
  );
}
