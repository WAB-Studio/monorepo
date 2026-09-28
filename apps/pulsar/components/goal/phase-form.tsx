"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { addPhase } from "@/app/actions/plan";
import { addPhaseSchema, phasesOverlap, type PhaseSpan } from "@/lib/validation/plan";
import { Button, Field, Flex, Page, SectionLabel, Text } from "@/components/ui";

import { weeksToPhaseSpan } from "./phase-weeks";

export type PhaseFormProps = {
  goalId: string;
  goalName: string;
  // The goal's own opening day, already read in the person's zone
  // (`civilDateInZone`) by the page: `weeksToPhaseSpan` is a pure function
  // over civil dates alone, never the browser's own zone.
  openedOn: string;
  defaultFromWeek: number;
  defaultToWeek: number;
  // Every phase the goal already has, spans alone: what the overlap refusal
  // checks against before the request ever reaches the server.
  existingPhases: PhaseSpan[];
};

// A week number typed by hand, bounded well under any real horizon — the
// same ample, arbitrary ceiling `cadenceN` takes in `lib/validation/plan.ts`,
// so a mistyped digit reads as a message instead of reaching date arithmetic.
const weekSchema = z.coerce.number().int().positive().max(2_600);

/**
 * `/metas/[goalId]/fases/nueva`, `CompromisoNuevo.dc.html`'s own shape (RP-15,
 * docs/pulsar/DESIGN.md "A goal adds a commitment from its own screen" — the
 * same pattern, a phase): what it looks for, and which weeks — converted to
 * the civil dates `addPhaseSchema` and `addPhase` actually store with
 * `weeksToPhaseSpan`, the one convention `goal-screen.tsx`'s own
 * `phaseSpanLabel` already counts by. The overlap check runs here first, so
 * a span the server would refuse never leaves the device; `addPhase` runs it
 * again, authoritative, inside its own transaction.
 */
export function PhaseForm({
  goalId,
  goalName,
  openedOn,
  defaultFromWeek,
  defaultToWeek,
  existingPhases,
}: PhaseFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [aim, setAim] = useState("");
  const [fromWeek, setFromWeek] = useState(String(defaultFromWeek));
  const [toWeek, setToWeek] = useState(String(defaultToWeek));
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (pending) return;
    setError(null);

    const fromResult = weekSchema.safeParse(fromWeek);
    const toResult = weekSchema.safeParse(toWeek);
    if (!fromResult.success || !toResult.success) {
      setError("plan.errors.weekInvalid");
      return;
    }
    if (toResult.data < fromResult.data) {
      setError("plan.errors.phaseBackwards");
      return;
    }

    const span = weeksToPhaseSpan(openedOn, fromResult.data, toResult.data);
    if (existingPhases.some((phase) => phasesOverlap(span, phase))) {
      setError("plan.errors.phaseOverlap");
      return;
    }

    const parsed = addPhaseSchema.safeParse({ goalId, aim, ...span });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    startTransition(() => {
      void addPhase(parsed.data).then((result) => {
        if (result.ok) {
          router.push(`/metas/${goalId}`);
          router.refresh();
        } else {
          setError(result.error);
        }
      });
    });
  }

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {goalName}
      </Text>
      <Text as="p" variant="title">
        {t("plan.phaseForm.title")}
      </Text>

      <Field
        label={t("plan.phaseForm.aimLabel")}
        value={aim}
        onChange={(event) => setAim(event.target.value)}
      />

      <section>
        <Flex direction="column" gap="3">
          <SectionLabel>{t("plan.phaseForm.weeksLabel")}</SectionLabel>
          <Flex gap="2">
            <Field
              label={t("plan.phaseForm.fromLabel")}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={fromWeek}
              onChange={(event) => setFromWeek(event.target.value)}
            />
            <Field
              label={t("plan.phaseForm.toLabel")}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={toWeek}
              onChange={(event) => setToWeek(event.target.value)}
            />
          </Flex>
        </Flex>
      </section>

      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}

      <Button block onClick={handleSubmit} disabled={pending}>
        {t("plan.phaseForm.submit")}
      </Button>
    </Page>
  );
}
