"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { createGoal } from "@/app/actions/plan";
import { createGoalSchema } from "@/lib/validation/plan";
import { horizonForWeeks } from "@/lib/day/weeks";
import { todayInZone } from "@/lib/zone";
import { Button, Field, Page, ScreenHeader, Text } from "@/components/ui";
import { messageKey, type MessageKey } from "@/i18n/translator";

// The board's own default (`MetaNueva.dc.html` draws "12 semanas" already
// filled): a quarter-length plan is the common case, and typing over a
// number costs less than typing one from nothing.
const DEFAULT_WEEKS = "12";

// A weeks count is this screen's own field — `createGoalSchema`
// only ever sees the civil date it becomes, never the number the person
// typed — so it is bounded here alone, before that conversion runs.
const weeksSchema = z.coerce.number().int().positive().max(520);

const NAME_ERRORS: MessageKey[] = ["plan.errors.nameEmpty", "plan.errors.nameTooLong"];
const HORIZON_ERRORS: MessageKey[] = ["goal.errors.horizonWeeksInvalid", "plan.errors.horizonInvalid"];

/**
 * `/metas/nueva` (RP-11, §0.3 3): a name and a horizon, nothing else. The
 * horizon is typed in weeks and turned into the civil date the shared schema
 * and `createGoal` actually store, with `lib/zone.ts`'s own arithmetic —
 * never the browser's zone (docs/pulsar/DESIGN.md "The day is `America/
 * Bogota`"). `createGoalSchema.safeParse` runs here first, so a name or a
 * horizon the server would refuse is refused before the request ever leaves
 * the device, with the same message either would carry.
 */
export function NewGoalForm() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [error, setError] = useState<MessageKey | null>(null);

  // The refusal reads under the field it is about, with its ring; only an
  // error no field owns (the server's) reads above the button.
  const nameRefusal = error && NAME_ERRORS.includes(error) ? t(error) : undefined;
  const horizonRefusal = error && HORIZON_ERRORS.includes(error) ? t(error) : undefined;

  function handleSubmit() {
    if (pending) return;
    setError(null);

    const weeksResult = weeksSchema.safeParse(weeks);
    if (!weeksResult.success) {
      setError("goal.errors.horizonWeeksInvalid");
      return;
    }

    const horizon = horizonForWeeks(todayInZone(), weeksResult.data);
    const parsed = createGoalSchema.safeParse({ name, horizon });
    if (!parsed.success) {
      setError(messageKey(parsed.error.issues[0].message));
      return;
    }

    startTransition(() => {
      void createGoal(parsed.data).then((result) => {
        if (result.ok) router.push(`/metas/${result.goalId}`);
        else setError(result.error);
      });
    });
  }

  return (
    <Page>
      <ScreenHeader
        title={t("goal.new.title")}
        back={{ href: "/metas", place: t("common.nav.goals") }}
        eyebrow={t("goal.new.overline")}
      />

      <Field
        label={t("goal.new.nameLabel")}
        value={name}
        onChange={(event) => setName(event.target.value)}
        invalid={nameRefusal !== undefined}
        hint={nameRefusal}
      />

      <Field
        label={t("goal.new.horizonLabel")}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={weeks}
        onChange={(event) => setWeeks(event.target.value)}
        invalid={horizonRefusal !== undefined}
        hint={horizonRefusal ?? t("goal.new.horizonHint")}
      />

      {error && !nameRefusal && !horizonRefusal ? (
        <Text as="p" tone="ink" variant="sentence">
          {t(error)}
        </Text>
      ) : null}

      <Button block onClick={handleSubmit} disabled={pending}>
        {t("goal.new.submit")}
      </Button>

      <Text as="p" tone="muted" variant="sentence">
        {t("goal.new.explain")}
      </Text>
    </Page>
  );
}
