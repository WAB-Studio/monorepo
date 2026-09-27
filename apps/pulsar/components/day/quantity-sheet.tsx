"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact } from "@/app/actions/facts";
import { Button, Chip, Field, Figure, Flex, SectionLabel, Sheet, Text } from "@/components/ui";

export type QuantitySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commitmentId: string;
  name: string;
  // The plan's own number and unit (RP-03): never typed, only ever read off
  // the commitment and offered back.
  target: number;
  unit: string;
};

// Four round numbers around the plan's own target, always ascending and
// always positive — the board draws four with the target already selected,
// never a fifth and never a menu (docs/pulsar/DESIGN.md "Decisions taken
// here"). The exact spread is this component's own choice, not the
// contract's: the contract fixes the middle chip, not the other three.
function chipsAround(target: number): number[] {
  const step = Math.max(1, Math.round(target / 2));
  const low = target - step > 0 ? target - step : target;
  const start = low === target ? target : low;
  const candidates =
    low === target
      ? [target, target + step, target + 2 * step, target + 3 * step]
      : [start, target, target + step, target + 2 * step];
  return Array.from(new Set(candidates)).sort((a, b) => a - b);
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
}: QuantitySheetProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(target);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [note, setNote] = useState("");
  const [wasOpen, setWasOpen] = useState(open);

  const chips = chipsAround(target);

  // Every open starts exactly where the plan expects (RP-03): the target
  // chip selected, no line written, no leftover error from a prior open.
  // Adjusted during render rather than an effect — the recommended way to
  // reset state on a prop change, since it bails out before a second paint.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(target);
      setCustomMode(false);
      setCustomValue("");
      setNote("");
      setError(null);
    }
  }

  function pickChip(value: number) {
    setCustomMode(false);
    setSelected(value);
  }

  function customQuantity(): number | null {
    const trimmed = customValue.trim();
    if (!/^[0-9]+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return value > 0 ? value : null;
  }

  const shownQuantity = customMode ? customQuantity() : selected;

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

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={name}
      description={t("day.quantitySheet.subtitle")}
    >
      <Figure value={shownQuantity ?? "–"} unit={unit} variant="measure" />

      <div>
        <SectionLabel>{t("day.quantitySheet.quantityLabel")}</SectionLabel>
        <Flex gap="2" wrap="wrap" mt="2">
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
        </Flex>
      </div>

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
    </Sheet>
  );
}
