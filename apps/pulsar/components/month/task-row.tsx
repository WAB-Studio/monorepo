"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, File, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { undoFact } from "@/app/actions/facts";
import { completeOneOff } from "@/app/actions/one-offs";
import { OneOffDeleteSheet } from "@/components/day/one-off-delete-sheet";
import { NoteSheet } from "@/components/one-offs/note-sheet";
import { ShiftSheet, type ShiftSheetProps } from "@/components/month/shift-sheet";
import { Button, Flex, IconButton, Mark, Panel, Row, Text } from "@/components/ui";
import { type MessageKey } from "@/i18n/translator";

export type TaskRowProps = {
  oneOffId: string;
  name: string;
  // The fact `undoFact` takes back; set only on a done leaf.
  factId: string | null;
  done: boolean;
  // A parent carries a chevron and no mark: it is done by its children (RP-30).
  parent?: boolean;
  child?: boolean;
  meta?: string;
  trailing?: string;
  // Names the open mark; absent, the month page's «Marcar como hecho».
  markLabel?: string;
  // The task's note, null when it has none (RP-45). A parent carries none.
  note?: string | null;
  // The note sheet's label: «nota · {goal} · {month}».
  noteEyebrow?: string;
};

/**
 * One task of a month (RP-30): a leaf marks itself done with its mark and is
 * taken back by tapping it done; its name opens the delete sheet. A parent
 * has no mark of its own.
 */
export function TaskRow({
  oneOffId,
  name,
  factId,
  done,
  parent,
  child,
  meta,
  trailing,
  markLabel,
  note = null,
  noteEyebrow,
}: TaskRowProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  function run(act: () => Promise<{ ok: boolean; error?: MessageKey }>) {
    if (pending) return;
    setError(null);
    startTransition(() => {
      void act().then((result) => {
        if (result.ok) router.refresh();
        else setError(result.error ?? "month.errors.invalid");
      });
    });
  }

  const trail = trailing ? (
    <Text variant="meta" tone="muted">
      {trailing}
    </Text>
  ) : undefined;

  // A parent is done by its children and carries no note of its own.
  const noteButton = parent ? undefined : (
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
  const noteProps = parent ? {} : { preview: note, end: noteButton };

  let row;
  if (parent) {
    row = (
      <Row
        leading={<ChevronRight size={20} aria-hidden />}
        name={
          <Text as="span" tone={done ? "muted" : undefined}>
            {name}
          </Text>
        }
        meta={meta}
        trailing={trail}
        data-done={done}
        onClick={() => setDeleteOpen(true)}
        disabled={pending}
      />
    );
  } else if (done) {
    row = (
      <Row
        leading={<Mark state="declared" />}
        aria-label={t("day.doneOneOffs.undoLabel", { name })}
        name={
          <Text as="span" tone="muted">
            {name}
          </Text>
        }
        meta={meta}
        trailing={trail}
        {...noteProps}
        onClick={() => factId && run(() => undoFact({ factId }))}
        disabled={pending || factId === null}
      />
    );
  } else {
    row = (
      <Row
        leading={<Mark state="empty" />}
        leadingLabel={markLabel ?? t("day.oneOffs.markLabel")}
        name={name}
        meta={meta}
        trailing={trail}
        {...noteProps}
        onLeadingClick={() => run(() => completeOneOff({ oneOffId }))}
        onClick={() => setDeleteOpen(true)}
        disabled={pending}
      />
    );
  }

  return (
    <Flex direction="column" ml={child ? "30px" : undefined}>
      {row}
      {error ? (
        <Text as="p" tone="muted" variant="meta" role="alert">
          {t(error)}
        </Text>
      ) : null}
      <OneOffDeleteSheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        oneOffId={oneOffId}
        name={name}
      />
      {parent ? null : (
        <NoteSheet
          open={noteOpen}
          onOpenChange={setNoteOpen}
          oneOffId={oneOffId}
          name={name}
          note={note}
          eyebrow={noteEyebrow ?? t("oneOffs.note.eyebrowLoose")}
        />
      )}
    </Flex>
  );
}

/**
 * `MesCorrer.dc.html` (RP-48): the proposal under a closed month's tasks and
 * the sheet it opens. The words arrive said, the plan arrives derived.
 */
export function ShiftProposal({
  proposal,
  see,
  until,
  compact,
  ...sheet
}: Omit<ShiftSheetProps, "open" | "onOpenChange"> & {
  see: string;
  // `MesesCorrer.dc.html`: on a month's row it is the trigger alone, with
  // neither the sentence nor the deadline.
  compact?: boolean;
  proposal?: string;
  until?: string;
}) {
  const [open, setOpen] = useState(false);
  if (compact) {
    return (
      <>
        <Button variant="ghost" tone="accent" onClick={() => setOpen(true)}>
          {see}
        </Button>
        <ShiftSheet {...sheet} open={open} onOpenChange={setOpen} />
      </>
    );
  }
  return (
    <Panel as="div" bordered>
      <Flex direction="column" gap="2" align="start">
        <Text as="p">{proposal}</Text>
        <Button variant="ghost" tone="accent" onClick={() => setOpen(true)}>
          {see}
        </Button>
        <Text as="p" variant="meta" tone="muted">
          {until}
        </Text>
      </Flex>
      <ShiftSheet {...sheet} open={open} onOpenChange={setOpen} />
    </Panel>
  );
}
