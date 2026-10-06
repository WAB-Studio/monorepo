"use client";

import { useState, useTransition } from "react";
import { File, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { NoteSheet } from "@/components/one-offs/note-sheet";
import { Button, Flex, IconButton, Mark, Text } from "@/components/ui";
import { useTimeWords } from "@/components/ui/figure";
import type { MessageKey } from "@/i18n/translator";
import { formatQuantity } from "@/lib/units/time";

/**
 * `HoyTareaMes.dc.html`: the goal's next task of the month under its figures,
 * with the mark that completes it. The refresh `completeOneOff` revalidates
 * is what brings the following task in; nothing is advanced here.
 */
export function MonthTaskLine({
  oneOffId,
  name,
  estimate,
  unit,
  note,
  noteEyebrow,
}: {
  oneOffId: string;
  name: string;
  estimate: number | null;
  unit: string;
  // Its button is drawn, never its text (`HoyNota`).
  note: string | null;
  noteEyebrow: string;
}) {
  const t = useTranslations();
  const words = useTimeWords();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);
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
      <Flex align="center" gap="2">
        <Flex ml="-3" asChild>
          <Button
            tap={44}
            variant="ghost"
            onClick={handleComplete}
            disabled={pending}
            aria-label={t("day.monthLine.markTask", { name })}
          >
            <Mark state="empty" />
          </Button>
        </Flex>
        <Text variant="name">{name}</Text>
        {estimate !== null ? (
          <Text variant="meta" tone="muted" end>
            {formatQuantity(estimate, unit, words)}
          </Text>
        ) : null}
        <Flex mr="-3">{noteButton}</Flex>
      </Flex>
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
