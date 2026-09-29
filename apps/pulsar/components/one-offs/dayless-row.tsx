"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { OneOffDeleteSheet } from "@/components/day/one-off-delete-sheet";
import { Mark, Row, Text } from "@/components/ui";

import { ScheduleSheet } from "./schedule-sheet";

export type DaylessRowProps = {
  oneOffId: string;
  name: string;
  // Already lowercased; absent for a one-off that belongs to no goal.
  goalName?: string;
};

/**
 * Hoy's one-off row, for a one-off with no day: the mark finishes it today
 * (`completeOneOff`), the name opens the sheet that gives it a day.
 */
export function DaylessRow({ oneOffId, name, goalName }: DaylessRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
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
        leadingLabel={t("oneOffs.markLabel", { name })}
        name={name}
        meta={goalName ? t("oneOffs.fromGoal", { goal: goalName }) : undefined}
        onLeadingClick={handleComplete}
        onClick={() => setScheduleOpen(true)}
        disabled={pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
      <ScheduleSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        oneOffId={oneOffId}
        name={name}
        onDelete={() => {
          setScheduleOpen(false);
          setDeleteOpen(true);
        }}
      />
      <OneOffDeleteSheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        oneOffId={oneOffId}
        name={name}
      />
    </>
  );
}
