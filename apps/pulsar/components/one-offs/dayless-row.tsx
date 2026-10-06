"use client";

import { useState, useTransition } from "react";
import { File, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { OneOffDeleteSheet } from "@/components/day/one-off-delete-sheet";
import { IconButton, Mark, Row, Text } from "@/components/ui";

import { NoteSheet } from "./note-sheet";
import { ScheduleSheet } from "./schedule-sheet";
import { type MessageKey } from "@/i18n/translator";

export type DaylessRowProps = {
  oneOffId: string;
  name: string;
  // As written; absent for a one-off that belongs to no goal.
  goalName?: string;
  // Present for a one-off that already has a day: its date in words.
  scheduled?: { day: string; label: string };
  // Called once the one-off is done, before the list drops its row.
  onDone?: (name: string) => void;
  note: string | null;
};

/**
 * A row of `/sueltas`: the mark finishes it today (`completeOneOff`), the
 * name opens the sheet that gives it a day, or moves it when it has one.
 */
export function DaylessRow({ oneOffId, name, goalName, scheduled, onDone, note }: DaylessRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

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

  const noteButton = (
    <IconButton
      tap={44}
      variant="ghost"
      tone={note ? "accent" : undefined}
      aria-label={t(note ? "oneOffs.note.view" : "oneOffs.note.open", { name })}
      onClick={() => setNoteOpen(true)}
      disabled={pending}
    >
      {note ? <FileText size={18} aria-hidden /> : <File size={18} aria-hidden />}
    </IconButton>
  );

  return (
    <>
      <Row
        leading={<Mark state="empty" />}
        leadingLabel={t("oneOffs.markLabel", { name })}
        name={name}
        meta={meta}
        onLeadingClick={handleComplete}
        preview={note}
        end={noteButton}
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
      <NoteSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        oneOffId={oneOffId}
        name={name}
        note={note}
        eyebrow={goalName ? t("oneOffs.note.eyebrowGoal", { goal: goalName }) : t("oneOffs.note.eyebrowLoose")}
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
