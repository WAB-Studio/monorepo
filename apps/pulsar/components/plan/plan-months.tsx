import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { TaskRow, type TaskRowProps } from "@/components/month/task-row";
import { Figure, Flex, Mark, Progress, Row, Section, Separator, Text } from "@/components/ui";
import { monthName } from "@/lib/plan/month-name";
import { monthOf } from "@/lib/plan/months";
import type { PlanItem, PlanMonth } from "@/lib/plan/roadmap";
import { openMonthsOf, planMonthOf } from "@/lib/plan/roadmap-read";
import type { GoalView } from "@/lib/queries/goal";
import { formatQuantity, type TimeWords } from "@/lib/units/time";

// Months drawn whole before the rest collapse: this one and the next.
const WHOLE = 2;

/**
 * `RoadmapPlan`'s month sections (RP-50, RP-54) and `RoadmapPasaElFinal`'s
 * «después de tu final». A task past the goal's end is listed there once, never
 * again in the month holding its hours.
 */
export async function PlanMonths({ goal, all }: { goal: GoalView; all: boolean }) {
  const t = await getTranslations();
  const units = await getTranslations("units");
  const words: TimeWords = {
    h: (h) => units("h", { h }),
    min: (min) => units("min", { min }),
    join: (h, min) => units("join", { h, min }),
  };
  const unit = goal.measureUnit;
  const say = (n: number) => (unit ? formatQuantity(n, unit, words) : String(n));
  const thisYear = String(new Date().getFullYear());
  const { roadmap } = goal;
  const lastMonth = monthOf(roadmap.lastDay);

  const pastEnd = new Map<string, PlanItem>();
  for (const month of roadmap.months) {
    for (const item of month.items) if (item.pastEnd && !pastEnd.has(item.task.id)) pastEnd.set(item.task.id, item);
  }
  const months = roadmap.months
    .map((month) => ({ ...month, items: month.items.filter((item) => !item.pastEnd) }))
    .filter((month) => month.items.length > 0 || month.month <= lastMonth);

  const openMonths = openMonthsOf(goal.plan);
  const pinned = goal.rhythm !== null;

  function rowOf(item: PlanItem, month: string) {
    const { task, children } = item;
    const parent = children.length > 0;
    const split = item.from !== null || item.to !== null;
    const planMonth =
      item.fixed || item.from !== null
        ? (planMonthOf(goal.plan, task.id)?.slice(0, 7) ?? null)
        : month.slice(0, 7);
    const sheetOf = (own: typeof task, kids: typeof children): TaskRowProps["sheet"] => ({
      goalId: goal.id,
      goalName: goal.name,
      unit,
      estimate: own.estimate,
      planMonth,
      months: own.parentId === null ? openMonths : [],
      canDelete: own.doneOn === null && kids.every((kid) => kid.doneOn === null),
      fixedMonth: own.plannedMonth?.slice(0, 7) ?? null,
    });
    return (
      <Flex key={task.id} direction="column">
        <TaskRow
          oneOffId={task.id}
          name={task.name}
          factId={task.factId ?? null}
          done={item.done}
          parent={parent}
          meta={item.carriedFrom !== null ? t("month.list.fromMonth", { month: monthName(item.carriedFrom, thisYear) }) : undefined}
          trailing={unit && item.part > 0 ? say(item.part) : undefined}
          note={task.note}
          part={split ? { part: item.part, hours: item.hours, from: item.from, to: item.to } : undefined}
          fixedMonth={pinned ? task.plannedMonth?.slice(0, 7) : undefined}
          sheet={sheetOf(task, children)}
        />
        {children.map((child) => (
          <TaskRow
            key={child.id}
            oneOffId={child.id}
            name={child.name}
            factId={child.factId ?? null}
            done={child.doneOn !== null}
            child
            trailing={unit && child.estimate ? say(child.estimate) : undefined}
            note={child.note}
            sheet={sheetOf(child, [])}
          />
        ))}
      </Flex>
    );
  }

  function figureOf(month: PlanMonth): string | null {
    if (!unit || month.amount === null) return null;
    const current = goal.month?.month === month.month ? goal.month : null;
    return t("roadmap.plan.reached", {
      done: say(current ? current.reached : month.filled),
      amount: say(current?.planned ?? month.amount),
    });
  }

  function percentOf(month: PlanMonth): number | null {
    if (!unit || month.amount === null || month.amount <= 0) return null;
    const current = goal.month?.month === month.month ? goal.month : null;
    return Math.floor(((current ? current.reached : month.filled) * 100) / (current?.planned ?? month.amount));
  }

  const whole = all ? months : months.slice(0, WHOLE);
  const rest = all ? [] : months.slice(WHOLE);
  const restItems = new Map<string, PlanItem>();
  for (const month of rest) for (const item of month.items) restItems.set(item.task.id, item);
  const restHours = rest.reduce((total, month) => total + month.items.reduce((sum, item) => sum + item.part, 0), 0);
  const pastItems = [...pastEnd.values()];
  const pastHours = pastItems.reduce((total, item) => total + item.hours, 0);

  return (
    <>
      {whole.map((month) => {
        const current = monthOf(goal.plan.today) === month.month;
        const figure = figureOf(month);
        const percent = percentOf(month);
        const label = current
          ? t("roadmap.plan.currentMonth", { month: monthName(month.month, thisYear) })
          : monthName(month.month, thisYear);
        return (
          <Section
            key={month.month}
            label={
              <Flex justify="between" gap="3">
                <span>{label}</span>
                {figure ? <span>{figure}</span> : null}
              </Flex>
            }
          >
            {percent !== null ? <Progress percent={percent} size="thick" /> : null}
            <Flex direction="column">{month.items.map((item) => rowOf(item, month.month))}</Flex>
          </Section>
        );
      })}
      {rest.length > 0 ? (
        <Section
          label={
            <Flex justify="between" gap="3">
              <span>
                {rest.length > 1
                  ? t("roadmap.plan.range", {
                      from: monthName(rest[0].month, thisYear),
                      to: monthName(rest[rest.length - 1].month, thisYear),
                    })
                  : monthName(rest[0].month, thisYear)}
              </span>
              <span>{t("roadmap.plan.summary", { count: restItems.size, hours: say(restHours) })}</span>
            </Flex>
          }
        >
          <Row
            card
            href={`/metas/${goal.id}/plan?todo=1`}
            name={t("roadmap.plan.seeRest")}
            trailing={<ChevronRight size={20} aria-hidden />}
            rule={false}
          />
        </Section>
      ) : null}
      {pastItems.length > 0 ? (
        <Section
          label={
            <Flex justify="between" gap="3">
              <span>{t("roadmap.pasaElFinal.afterEnd")}</span>
              <span>{t("roadmap.pasaElFinal.summary", { count: pastItems.length, hours: say(pastHours) })}</span>
            </Flex>
          }
        >
          <div>
            {pastItems.map((item) => (
              <div key={item.task.id}>
                <Flex align="center" justify="between" gap="3" py="3">
                  <Flex align="center" gap="3">
                    <Mark state="empty" dashed />
                    <Text variant="name">{item.task.name}</Text>
                  </Flex>
                  {unit ? <Figure variant="meta" value={item.hours} unit={unit} /> : null}
                </Flex>
                <Separator />
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
