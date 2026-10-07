"use client";

import { ChevronRight } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { moveHorizon } from "@/app/actions/plan";
import { RhythmSheet } from "@/components/plan/rhythm-sheet";
import { TaskSheet } from "@/components/plan/task-sheet";
import { Button, Flex, Row, Text } from "@/components/ui";
import { Figure, useTimeWords } from "@/components/ui/figure";
import { type MessageKey } from "@/i18n/translator";
import type { PlanInput } from "@/lib/plan/roadmap";
import { formatQuantity } from "@/lib/units/time";
import { civilDateLabel } from "@/lib/zone";

/**
 * `RoadmapPasaElFinal`'s two offers (RP-53): raise the rhythm to the one that
 * meets the end, or move the end to the plan's in one tap.
 */
export function PlanEnd({
  goalId,
  goalName,
  unit,
  plan,
  meets,
  planEnd,
  moveTo,
}: {
  goalId: string;
  goalName: string;
  unit: string | null;
  plan: PlanInput;
  // The rhythm that reaches the goal's end; null when none does.
  meets: number | null;
  // The day the plan ends, and the horizon that holds it.
  planEnd: string;
  moveTo: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const words = useTimeWords();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);

  function move() {
    if (pending) return;
    setError(null);
    startTransition(() => {
      void moveHorizon({ goalId, horizon: moveTo }).then((result) => {
        if (result.ok) router.refresh();
        else setError(result.error ?? "plan.errors.notFound");
      });
    });
  }

  return (
    <Flex direction="column" gap="3">
      {unit && meets !== null ? (
        <RhythmSheet
          goalId={goalId}
          goalName={goalName}
          unit={unit}
          plan={plan}
          initial={meets}
          name={t("roadmap.pasaElFinal.raise")}
          meta={t.rich("roadmap.pasaElFinal.raiseHint", {
            hours: formatQuantity(meets, unit, words),
            fig: (chunks) => <Figure variant="meta" value={chunks} />,
          })}
        />
      ) : null}
      <Row
        card
        rule={false}
        name={t("roadmap.pasaElFinal.moveEnd")}
        meta={t("roadmap.pasaElFinal.moveEndHint", { date: civilDateLabel(planEnd) })}
        metaVariant="sentence"
        trailing={<ChevronRight size={20} aria-hidden />}
        onClick={move}
        disabled={pending}
      />
      {error ? (
        <Text as="p" variant="sentence" role="alert">
          {t(error)}
        </Text>
      ) : null}
      <Text as="p" variant="sentence">
        {t("roadmap.pasaElFinal.removeTasks")}
      </Text>
    </Flex>
  );
}

/** The plan's footer (RP-55): «Añadir una tarea» opens `RoadmapTareaNueva`. */
export function AddTask({
  goalId,
  goalName,
  unit,
  months,
}: {
  goalId: string;
  goalName: string;
  unit: string | null;
  months: string[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("roadmap.plan.addTask")}</Button>
      <TaskSheet
        mode="create"
        goalId={goalId}
        goalName={goalName}
        unit={unit}
        fixedMonth={null}
        planMonth={null}
        months={months}
        done={false}
        kind="task"
        canDelete={false}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
