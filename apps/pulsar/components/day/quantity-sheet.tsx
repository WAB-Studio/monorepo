"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact, undoFact } from "@/app/actions/facts";
import { quantitySchema } from "@/lib/validation/fact";
import { Button, Chip, Field, Flex, Sheet, Text } from "@/components/ui";

export type QuantitySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commitmentId: string;
  name: string;
  // The plan's own number and unit (RP-03): never typed, only ever read off
  // the commitment and offered back.
  target: number;
  unit: string;
  // Today's own fact, only when the row is already done (RP-05): its
  // presence is what turns the sheet from "declare" into "declared, and
  // undoable". Reopening prefills the figure and note it actually holds,
  // never the plan's target again.
  factId?: string;
  loggedQuantity?: number | null;
  loggedNote?: string | null;
};

// Four consecutive integers, the target second — `HoyCantidad.dc.html`'s own
// spread, never a fifth and never a menu (docs/pulsar/DESIGN.md "Decisions
// taken here"). `target` is always >=1 (the column's own CHECK), so `target
// - 1` only ever goes non-positive at `target === 1`, the one case with no
// smaller integer to offer: `[1, 2, 3, 4]`, with 1 — still the target —
// selected.
function chipsAround(target: number): number[] {
  if (target <= 1) return [1, 2, 3, 4];
  return [target - 1, target, target + 1, target + 2];
}

/**
 * Takes a commitment's number in the same gesture that satisfies it (RP-03),
 * plus one optional line (RP-04). Offered as chips, the target already
 * selected; typing is the exception a person reaches for on purpose, never
 * the path the sheet opens on (docs/pulsar/DESIGN.md "Decisions taken
 * here"). Accepting never asks again — no confirmation stands between the
 * tap and the closed sheet.
 */
export function QuantitySheet({
  open,
  onOpenChange,
  commitmentId,
  name,
  target,
  unit,
  factId,
  loggedQuantity,
  loggedNote,
}: QuantitySheetProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(loggedQuantity ?? target);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [note, setNote] = useState(loggedNote ?? "");
  const [wasOpen, setWasOpen] = useState(open);

  const chips = chipsAround(target);

  // Every open starts where today's own row stands: the logged figure and
  // note when the row is done (RP-04, RP-05), the plan's own target and a
  // blank line otherwise — never a leftover from a prior open. Adjusted
  // during render rather than an effect — the recommended way to reset
  // state on a prop change, since it bails out before a second paint.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(loggedQuantity ?? target);
      setCustomMode(loggedQuantity != null && !chipsAround(target).includes(loggedQuantity));
      setCustomValue(loggedQuantity != null ? String(loggedQuantity) : "");
      setNote(loggedNote ?? "");
      setError(null);
    }
  }

  function pickChip(value: number) {
    setCustomMode(false);
    setSelected(value);
  }

  // The same bound the server enforces (`quantitySchema`, `lib/validation/
  // fact.ts`), run here first: a number this schema refuses is a number
  // `declareFact` would have refused too, never a raw Postgres error.
  function customQuantity(): number | null {
    const trimmed = customValue.trim();
    if (trimmed.length === 0) return null;
    const parsed = quantitySchema.safeParse(Number(trimmed));
    return parsed.success ? parsed.data : null;
  }

  function handleAccept() {
    if (pending) return;
    const quantity = customMode ? customQuantity() : selected;
    if (quantity == null) {
      setError("day.errors.quantityInvalid");
      return;
    }
    const trimmedNote = note.trim();
    setError(null);

    startTransition(() => {
      void declareFact({
        commitmentId,
        quantity,
        note: trimmedNote.length > 0 ? trimmedNote : undefined,
      }).then((result) => {
        if (result.ok) onOpenChange(false);
        else setError(result.error);
      });
    });
  }

  // The same gesture the day row itself offers a done `tap` row (RP-05): no
  // confirm sheet here either, since this sheet's own "Deshacer" already is
  // the confirm — a person who opened it to look can still just close it.
  function handleUndo() {
    if (pending || !factId) return;
    setError(null);

    startTransition(() => {
      void undoFact({ factId }).then((result) => {
        if (result.ok) onOpenChange(false);
        else setError(result.error);
      });
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      label={name}
      title={t("day.quantitySheet.question")}
    >
      <Flex gap="2" wrap="wrap" align="center">
        {chips.map((value) => (
          <Chip
            key={value}
            mono
            selected={!customMode && selected === value}
            onClick={() => pickChip(value)}
          >
            {value}
          </Chip>
        ))}
        {/* The heading stays neutral; a unit inside it would need a gender. */}
        <Text variant="meta" tone="quiet">
          {unit}
        </Text>
      </Flex>

      {customMode ? (
        <Field
          label={t("day.quantitySheet.customLabel")}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          autoFocus
        />
      ) : (
        <Button variant="ghost" onClick={() => setCustomMode(true)}>
          {t("day.quantitySheet.otherAmount")}
        </Button>
      )}

      <Field
        label={t("day.quantitySheet.noteLabel")}
        placeholder={t("day.quantitySheet.notePlaceholder")}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}

      <Button block onClick={handleAccept} disabled={pending}>
        {t("day.quantitySheet.accept")}
      </Button>
      {factId ? (
        <Button block variant="outline" onClick={handleUndo} disabled={pending}>
          {t("day.quantitySheet.undo")}
        </Button>
      ) : null}
    </Sheet>
  );
}
