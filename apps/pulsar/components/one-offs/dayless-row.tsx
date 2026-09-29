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
  // As written; absent for a one-off that belongs to no goal.
  goalName?: string;
  // Present for a one-off that already has a day: its date in words.
  scheduled?: { day: string; label: string };
  // Called once the one-off is done, before the list drops its row.
  onDone?: (name: string) => void;
};

/**
 * A row of `/sueltas`: the mark finishes it today (`completeOneOff`), the
 * name opens the sheet that gives it a day, or moves it when it has one.
 */
export function DaylessRow({ oneOffId, name, goalName, scheduled, onDone }: DaylessRowProps) {
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
        if (result.ok) onDone?.(name);
        else setError(result.error);
      });
    });
  }

  let meta: string | undefined;
  if (scheduled && goalName) meta = t("oneOffs.whenWithGoal", { when: scheduled.label, goal: goalName });
  else if (scheduled) meta = scheduled.label;
  else if (goalName) meta = t("oneOffs.fromGoal", { goal: goalName });

  return (
    <>
      <Row
        leading={<Mark state="empty" />}
        leadingLabel={t("oneOffs.markLabel", { name })}
        name={name}
        meta={meta}
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
        key={scheduled?.day}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        oneOffId={oneOffId}
        name={name}
        current={scheduled}
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
