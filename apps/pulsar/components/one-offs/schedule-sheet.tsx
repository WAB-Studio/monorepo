"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { scheduleOneOff } from "@/app/actions/one-offs";
import { DayChoice } from "@/components/day/day-choice";
import {
  DEFAULT_DAY_CHOICE,
  dayForChoice,
  type DayChoiceValue,
} from "@/components/day/day-for-choice";
import { Button, Sheet, Text } from "@/components/ui";
import { scheduleOneOffSchema } from "@/lib/validation/one-off";
import { todayInZone } from "@/lib/zone";

export type ScheduleSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oneOffId: string;
  name: string;
  onDelete: () => void;
};

/**
 * `SueltaDarDia.dc.html` (RP-21): «para cuándo» without «sin día», the way
 * to give the one-off that day, and the way to the delete sheet.
 */
export function ScheduleSheet({ open, onOpenChange, oneOffId, name, onDelete }: ScheduleSheetProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<DayChoiceValue>(DEFAULT_DAY_CHOICE);
  const [error, setError] = useState<string | null>(null);

  function handleSchedule() {
    if (pending) return;

    // The schema the server runs, run first: a refused day never travels.
    const parsed = scheduleOneOffSchema.safeParse({
      oneOffId,
      day: dayForChoice(choice, todayInZone()),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);

    // Closed inside the transition so the close commits with the refreshed
    // list, never before it.
    startTransition(async () => {
      const result = await scheduleOneOff(parsed.data);
      if (result.ok) onOpenChange(false);
      else setError(result.error);
    });
  }

  const dateError = choice.kind === "other" && error?.startsWith("day.errors.oneOffDay") ? error : null;
  const otherError = dateError ? null : error;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      label={name.toLocaleUpperCase("es")}
      title={t("oneOffs.schedule.title")}
    >
      <DayChoice
        value={choice}
        onChange={(next) => {
          setChoice(next);
          setError(null);
        }}
        allowNone={false}
        min={todayInZone()}
        error={dateError}
      />
      {otherError ? (
        <Text as="p" tone="muted" variant="meta">
          {t(otherError)}
        </Text>
      ) : null}
      <Button block onClick={handleSchedule} disabled={pending}>
        {t("oneOffs.schedule.confirm")}
      </Button>
      <Button block variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
        {t("oneOffs.schedule.keep")}
      </Button>
      <Button tap={44} variant="ghost" onClick={onDelete} disabled={pending}>
        <Text variant="meta" tone="muted">
          {t("oneOffs.schedule.delete")}
        </Text>
      </Button>
    </Sheet>
  );
}
