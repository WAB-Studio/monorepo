"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { createOneOff } from "@/app/actions/one-offs";
import { createOneOffSchema } from "@/lib/validation/one-off";
import { Button, Field, Flex, Mark, Text } from "@/components/ui";
import { dayWords } from "@/lib/day/day-words";
import { todayInZone } from "@/lib/zone";

import { DayChoice } from "./day-choice";
import { DEFAULT_DAY_CHOICE, dayForChoice, type DayChoiceValue } from "./day-for-choice";
import { messageKey, type MessageKey } from "@/i18n/translator";

export type NewOneOffProps = {
  // Absent, the one-off written here belongs to nothing (RP-20); given, it is
  // written from that goal's own group, the same gesture either way — there
  // is no second form for the goal-scoped case.
  goalId?: string;
  // The dayless one-offs the person holds, so a write with no day can say
  // which number it just raised.
  daylessCount?: number;
  // The goal's name as written; it names the field (RP-20).
  goalName?: string;
};

/**
 * The field at the foot of the day (RP-19), permanently visible under the
 * one-offs it feeds: type a name, submit, and it lands on today with no
 * sheet and no screen of its own (docs/pulsar/DESIGN.md "Decisions taken
 * here"). The mark beside it is the design's one dashed stroke, drawn empty
 * because this is the one row nothing has written yet.
 *
 * Once there is a name, «para cuándo» appears under it: today is already
 * chosen, so Enter alone still writes today. Any other choice shows «Anotar»,
 * because Enter in the date field would otherwise write nothing. A one-off written for another
 * day, or none, does not draw on Hoy, so the field says where it went.
 */
export function NewOneOff({ goalId, daylessCount = 0, goalName }: NewOneOffProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<DayChoiceValue>(DEFAULT_DAY_CHOICE);
  const [error, setError] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function savedMessage(kind: DayChoiceValue["kind"], day: string | null): string | null {
    if (kind === "none") return t("day.newOneOff.savedNone", { count: daylessCount + 1 });
    if (kind === "today" || day === null) return null;
    const words = dayWords(day, todayInZone());
    const weekdays = t.raw("day.weekdayLong") as string[];
    const months = t.raw("day.monthLong") as string[];
    const parts = {
      weekday: weekdays[words.weekday],
      day: words.day,
      month: words.month === null ? "" : months[words.month],
    };
    const key = kind === "tomorrow" ? "savedTomorrow" : "savedOther";
    return t(words.month === null ? `day.newOneOff.${key}` : `day.newOneOff.${key}Far`, parts);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards a second submit fired while the first is still in flight
    // (a fast double tap on a virtual keyboard's "go") from landing a
    // second row: the field stays disabled for the same span.
    if (pending) return;

    const day = dayForChoice(choice, todayInZone());

    // The same schema the server runs (`createOneOff`, `app/actions/one-
    // offs.ts`), run here first: a name this refuses never reaches the
    // network, the same discipline `QuantitySheet` already holds for a
    // quantity (`lib/validation/fact.ts`'s `quantitySchema`).
    const parsed = createOneOffSchema.safeParse({ name, day, goalId });
    if (!parsed.success) {
      setError(messageKey(parsed.error.issues[0].message));
      return;
    }
    setError(null);
    setSaved(null);

    startTransition(() => {
      void createOneOff(parsed.data).then((result) => {
        if (result.ok) {
          setName("");
          setChoice(DEFAULT_DAY_CHOICE);
          setSaved(savedMessage(choice.kind, day));
        } else setError(result.error);
      });
    });
  }

  const dateError = choice.kind === "other" && error?.startsWith("day.errors.oneOffDay") ? error : null;
  const nameError = dateError ? null : error;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Flex align="center" gap="2">
        <Mark state="empty" dashed />
        <Field
          label={goalName ? t("day.newOneOff.labelForGoal", { goal: goalName }) : t("day.newOneOff.label")}
          hideLabel
          placeholder={
            goalName
              ? t("day.newOneOff.placeholderForGoalShort", { goal: goalName })
              : t("day.newOneOff.placeholder")
          }
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(null);
          }}
          disabled={pending}
        />
      </Flex>
      {name.trim() !== "" ? (
        <DayChoice
          value={choice}
          onChange={(next) => {
            setChoice(next);
            setError(null);
          }}
          allowNone
          min={todayInZone()}
          error={dateError}
          action={
            choice.kind !== "today" ? (
              <Button type="submit" tap={44} disabled={pending}>
                {t("day.newOneOff.submit")}
              </Button>
            ) : null
          }
        />
      ) : null}
      {nameError ? (
        <Text as="p" variant="sentence">
          {t(nameError)}
        </Text>
      ) : null}
      {saved ? (
        <Text as="p" role="status" tone="accent" variant="sentence">
          {saved}
        </Text>
      ) : null}
    </form>
  );
}
