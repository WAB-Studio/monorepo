"use client";

import { useState, useTransition } from "react";
import { File, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { undoFact } from "@/app/actions/facts";
import { NoteSheet } from "@/components/one-offs/note-sheet";
import { IconButton, Mark, Row, Text } from "@/components/ui";
import { type MessageKey } from "@/i18n/translator";

export type DoneOneOffRowProps = {
  factId: string;
  name: string;
  // The hour it was done, already said in the person's zone.
  time?: string;
  // The note it holds, never drawn here: only its button is (`HoyNota`).
  note: string | null;
  // The id of the one-off the fact belongs to, which the note is written on.
  oneOffId: string;
  noteEyebrow: string;
};

/**
 * A one-off done today (RP-19): the whole row is the one control and takes
 * the fact back, so the one-off returns among the undone (RP-05). It opens
 * nothing — a done one-off is not deleted (RP-22).
 */
export function DoneOneOffRow({ factId, name, time, note, oneOffId, noteEyebrow }: DoneOneOffRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  function handleUndo() {
    if (pending) return;
    setError(null);

    startTransition(() => {
      void undoFact({ factId }).then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

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
        leading={<Mark state="declared" />}
        aria-label={t("day.doneOneOffs.undoLabel", { name })}
        name={
          <Text as="span" tone="muted">
            {name}
          </Text>
        }
        meta={time}
        onClick={handleUndo}
        end={noteButton}
        disabled={pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
      <NoteSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        oneOffId={oneOffId}
        name={name}
        note={note}
        eyebrow={noteEyebrow}
      />
    </>
  );
}
