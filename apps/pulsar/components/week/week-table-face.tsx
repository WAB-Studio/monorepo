import type { getTranslations } from "next-intl/server";

import { Panel, WeekTable, type MarkState } from "@/components/ui";
import type { WeekTableColumn } from "@/components/ui/week-table";
import { tallyDays } from "@/lib/day/tally";
import type { DaySlot } from "@/lib/day/types";
import type { loadWeek } from "@/lib/queries/week";

import { flexibleWords, goalWeekProgress } from "./week-progress";

type Translate = Awaited<ReturnType<typeof getTranslations>>;
type Week = Awaited<ReturnType<typeof loadWeek>>;

function slotState(slot: DaySlot): MarkState {
  if (slot.satisfiedBy === "evidence") return "evidence";
  return slot.satisfied ? "declared" : "empty";
}

function slotLabel(name: string, slot: DaySlot, t: Translate): string {
  if (slot.satisfiedBy === "evidence" && slot.labelKey) {
    return t("week.dot.evidence", { name, source: t(slot.labelKey) });
  }
  return t("week.dot.commitment", {
    name,
    status: t(slot.satisfied ? "week.dot.done" : "week.dot.pending"),
  });
}

/**
 * `SemanaEscritorio.dc.html`: the week as commitments down and days across.
 * A day on or after a goal's horizon draws nothing for it, the way the list
 * does; a day the goal's commitment did not exist has no slot and is empty.
 */
export function WeekTableFace({
  week,
  today,
  columns,
  t,
}: {
  week: Week;
  today: string;
  columns: readonly WeekTableColumn[];
  t: Translate;
}) {
  const { view, goals, commitments, oneOffFacts } = week;
  const days = view.days.map((dayView) => dayView.day);
  const horizonOf = new Map(goals.map((goal) => [goal.id, goal.horizon]));
  const live = (goalId: string | null, day: string) =>
    goalId === null || day < (horizonOf.get(goalId) ?? "");

  const commitmentRows = (goalId: string) =>
    commitments
      .filter((commitment) => commitment.goalId === goalId)
      .map((commitment) => {
        const words = flexibleWords(commitment, t);
        return {
          key: commitment.id,
          name: commitment.name,
          detail: words ? t("week.flexible.detail", words) : undefined,
          cells: view.days.map((dayView) => {
            if (!live(goalId, dayView.day)) return null;
            const slot = dayView.slots.find(
              (s) => s.commitmentId === commitment.id,
            );
            // A flexible row marks the days it was done and leaves the rest
            // quiet: no day of it was ever asked on its own.
            if (words && !slot?.satisfied) return null;
            return slot
              ? {
                  state: slotState(slot),
                  label: slotLabel(commitment.name, slot, t),
                }
              : null;
          }),
        };
      });

  const oneOffRows = (goalId: string | null) =>
    oneOffFacts
      .filter((fact) => fact.goalId === goalId)
      .map((fact) => ({
        key: fact.oneOffId,
        name: fact.name,
        cells: days.map((day) =>
          day === fact.day && live(goalId, day)
            ? { state: "declared" as const, label: t("week.dot.oneOff") }
            : null,
        ),
      }));

  const groups = [
    ...goals.map((goal) => {
      const progress = goalWeekProgress(goal, view.start);
      return {
        key: goal.id,
        label: progress
          ? t("week.sectionLabel", {
              name: goal.name,
              week: progress.week,
              total: progress.total,
            })
          : goal.name,
        rows: [...commitmentRows(goal.id), ...oneOffRows(goal.id)],
      };
    }),
    { key: "one-offs", label: t("week.oneOffs.title"), rows: oneOffRows(null) },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  const cells = tallyDays(week).map(({ day, done, total }) =>
    day > today || total === 0 ? "" : t("week.ratio", { done, total }),
  );

  return (
    <Panel as="div">
      <WeekTable
        caption={t("week.table.caption")}
        columns={columns}
        groups={groups}
        footer={{ label: t("week.table.footer"), cells }}
      />
    </Panel>
  );
}
