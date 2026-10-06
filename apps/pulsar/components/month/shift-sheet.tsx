"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { acceptShift } from "@/app/actions/shift";
import { shiftRows } from "@/lib/plan/shift-rows";
import type { ShiftPlan } from "@/lib/plan/shift";
import { Button, Flex, Section, Sheet, SheetActions, Text } from "@/components/ui";

export type ShiftSheetProps = {
  goalId: string;
  goalName: string;
  month: string;
  plan: ShiftPlan;
  // What stays: the phase under way, whether any task is done, the other goals.
  currentPhase: string | null;
  hasDoneTasks: boolean;
  otherGoals: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function Line({ name, detail }: { name: string; detail: string }) {
  return (
    <Flex justify="between" gap="3">
      <Text variant="name">{name}</Text>
      <Text variant="meta" tone="muted">
        {detail}
      </Text>
    </Flex>
  );
}

/**
 * `MesCorrerHoja.dc.html` (RP-48): what accepting the shift moves and what it
 * leaves, from 142's plan, accepted in one confirm through 143.
 */
export function ShiftSheet({
  goalId,
  goalName,
  month,
  plan,
  currentPhase,
  hasDoneTasks,
  otherGoals,
  open,
  onOpenChange,
}: ShiftSheetProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = shiftRows(plan);
  const stays = currentPhase !== null || hasDoneTasks || otherGoals.length > 0;

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await acceptShift({ goalId, month });
    setPending(false);
    if (result.ok) {
      onOpenChange(false);
      router.refresh();
    } else {
      setError(t(result.error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={goalName} title={t("month.shift.title")}>
      <Flex direction="column" gap={{ initial: "6", md: "7" }}>
        <Section as="div" label={t("month.shift.movesTitle")}>
          {rows.budgets ? (
            <Line
              name={t("month.shift.budgets", { from: rows.budgets.from, to: rows.budgets.to })}
              detail={t("month.shift.budgetsDetail", { from: rows.budgets.from, next: rows.budgets.next })}
            />
          ) : null}
          {rows.tasks ? (
            <Line
              name={t("month.shift.tasks", { count: rows.tasks.count })}
              detail={t("month.shift.tasksDetail", { month: rows.tasks.month })}
            />
          ) : null}
          {rows.phases.map((phase) => (
            <Line
              key={phase.name}
              name={t("month.shift.phase", { name: phase.name })}
              detail={t("month.shift.phaseDetail", { from: phase.from, to: phase.to })}
            />
          ))}
          {rows.end ? (
            <Line
              name={t("month.shift.end")}
              detail={t("month.shift.endDetail", { from: rows.end.from, to: rows.end.to })}
            />
          ) : null}
        </Section>

        {stays ? (
          <Section as="div" label={t("month.shift.staysTitle")}>
          {currentPhase !== null ? <Line name={t("month.shift.currentPhase")} detail={currentPhase} /> : null}
          {hasDoneTasks ? (
            <Line name={t("month.shift.doneTasks")} detail={t("month.shift.doneTasksDetail")} />
          ) : null}
          {otherGoals.length > 0 ? (
            <Line name={t("month.shift.otherGoals")} detail={otherGoals.join(", ")} />
          ) : null}
          </Section>
        ) : null}

        <Text as="p" variant="sentence">
          {t("month.shift.nextKeeps", { month: rows.emptied })}
        </Text>
        {error ? (
          <Text as="p" variant="sentence" role="alert">
            {error}
          </Text>
        ) : null}
      </Flex>
      <SheetActions>
        <Button block onClick={handleConfirm} disabled={pending}>
          {t("month.shift.confirm")}
        </Button>
        <Button block variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          {t("month.shift.cancel")}
        </Button>
      </SheetActions>
    </Sheet>
  );
}
