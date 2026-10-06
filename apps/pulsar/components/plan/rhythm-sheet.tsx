"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Sheet } from "@/components/ui";
import type { PlanInput } from "@/lib/plan/roadmap";

import { RhythmForm } from "./rhythm-form";

/**
 * `RoadmapRitmoHoja` (RP-50): a link that opens the rhythm form in a sheet,
 * prefilled with `initial` — the goal's rhythm, or the one «Subir el ritmo»
 * names.
 */
export function RhythmSheet({
  goalId,
  goalName,
  unit,
  plan,
  initial,
  trigger,
}: {
  goalId: string;
  goalName: string;
  unit: string;
  plan: PlanInput;
  initial: number | null;
  trigger: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" tone="accent" tap={44} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        label={t("roadmap.ritmo.eyebrow", { goal: goalName })}
        title={t("roadmap.ritmo.title")}
      >
        {open ? (
          <RhythmForm
            sheet
            goalId={goalId}
            unit={unit}
            plan={plan}
            initial={initial}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </Sheet>
    </>
  );
}
