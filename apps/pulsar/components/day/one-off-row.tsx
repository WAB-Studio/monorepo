"use client";

import { useState, useTransition } from "react";
import { File, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { NoteSheet } from "@/components/one-offs/note-sheet";
import { IconButton, Mark, Row, Text } from "@/components/ui";

import { OneOffDeleteSheet } from "./one-off-delete-sheet";
import { type MessageKey } from "@/i18n/translator";

export type OneOffRowProps = {
  oneOffId: string;
  name: string;
  // «del sábado 19»: set only on a one-off carried from a day before the one
  // drawn (RP-19), so today's own read with no second line.
  carriedFrom?: string;
  // The note it holds, never drawn here: only its button is (`HoyNota`).
  note: string | null;
  noteEyebrow: string;
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
export function OneOffRow({ oneOffId, name, carriedFrom, note, noteEyebrow }: OneOffRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  function handleComplete() {
    if (pending) return;
    setError(null);

    startTransition(() => {
      void completeOneOff({ oneOffId }).then((result) => {
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
        leading={<Mark state="empty" />}
        leadingLabel={t("day.oneOffs.markLabel")}
        name={name}
        meta={carriedFrom}
        onLeadingClick={handleComplete}
        onClick={() => setDeleteOpen(true)}
        end={noteButton}
        disabled={pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="sentence">
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
      <OneOffDeleteSheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        oneOffId={oneOffId}
        name={name}
      />
    </>
  );
}
