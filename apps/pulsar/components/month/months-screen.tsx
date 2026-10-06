import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BudgetSheet } from "@/components/month/budget-sheet";
import { MonthDetail } from "@/components/month/month-screen";
import { ShiftProposal } from "@/components/month/task-row";
import { carryShare, monthOfTask } from "@/lib/plan/carry";
import { shiftOfferNow } from "@/lib/plan/shift-offer";
import { listGoals, loadGoal, type GoalView } from "@/lib/queries/goal";
import { formatQuantity, type TimeWords } from "@/lib/units/time";
import { todayInZone } from "@/lib/zone";
import { Button, ListDetail, Page, ScreenHeader, Table, Text, type TableRow } from "@/components/ui";

const monthFormat = new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" });

// "2026-10-01" as «octubre».
function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}T12:00:00Z`));
}

/**
 * `MesesFilas.dc.html` (RP-32): one whole-row link per month of the goal's
 * span from `loadGoal`'s own `months`, the month open beside the list marked.
 * The phone's stack is drawn at every width: the list lives in a 320px column
 * from 1024. A month's amount is set from its own page, never from the row.
 */
export async function MonthsList({ goal, open }: { goal: GoalView; open: string }) {
  const t = await getTranslations();
  const hrefOf = (month: string) => `/metas/${goal.id}/meses/${month.slice(0, 7)}`;
  const caption = t("month.months.caption", { count: goal.months.length });
  const currentIndex = goal.months.findIndex((row) => row.current);
  const openIndex = goal.months.findIndex((row) => row.month === open);

  if (!goal.measureUnit || !goal.measureName) {
    const counts = new Map<string, number>();
    for (const task of goal.tasks) {
      if (task.parentId !== null) continue;
      const month = monthOfTask(task);
      if (month !== null) counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    const bare: TableRow[] = goal.months.map((row) => {
      const count = counts.get(row.month) ?? 0;
      const tasks = (
        <Text tone="secondary">
          {count === 0
            ? t("month.months.withoutMeasure.none")
            : t("month.months.withoutMeasure.tasks", { count })}
        </Text>
      );
      return {
        key: row.month,
        href: hrefOf(row.month),
        cells: [monthLabel(row.month), tasks],
        detail: row.current ? t("month.months.current") : null,
        note: tasks,
      };
    });
    return (
      <Table
        narrow
        caption={caption}
        columns={[t("month.months.columns.month"), t("month.months.withoutMeasure.columnTasks")]}
        rows={bare}
        current={currentIndex === -1 ? undefined : currentIndex}
        open={openIndex === -1 ? undefined : openIndex}
      />
    );
  }

  const unit = goal.measureUnit;
  const units = await getTranslations("units");
  const words: TimeWords = {
    h: (h) => units("h", { h }),
    min: (min) => units("min", { min }),
    join: (h, min) => units("join", { h, min }),
  };

  const rows: TableRow[] = goal.months.map((row) => {
    const started = row.past || row.current;
    const share = row.past ? carryShare(goal.tasks, row.month.slice(0, 7) + "-01") : null;
    const figure = row.planned === null ? null : formatQuantity(row.planned, unit, words);
    const amount = (
      <Text tone="secondary">
        {figure === null
          ? t("month.months.noAmount")
          : started
            ? t("month.months.of", { planned: figure })
            : figure}
      </Text>
    );
    const state = row.current
      ? t("month.months.current")
      : share
        ? t("month.months.carried", { share: Math.floor((share.carried * 100) / share.planned) })
        : row.planned !== null && !started
          ? t("month.months.planned")
          : null;

    return {
      key: row.month,
      href: hrefOf(row.month),
      cells: [monthLabel(row.month), started ? row.reached : null, amount],
      detail: state,
      note: amount,
    };
  });

  return (
    <Table
      narrow
      caption={caption}
      columns={[
        t("month.months.columns.month"),
        t("month.months.columns.reached"),
        t("month.months.columns.planned"),
      ]}
      rows={rows}
      figures={[1]}
      unit={unit}
      current={currentIndex === -1 ? undefined : currentIndex}
      open={openIndex === -1 ? undefined : openIndex}
    />
  );
}

/**
 * `MesesFilas.dc.html` / `MesesListaDetalle.dc.html` / `MesesVacio.dc.html` /
 * `MesesSinMedida.dc.html` (RP-28, RP-31, RP-32, RP-48): the goal's months, and
 * from 1024 the month beside them — the current one, or the first outside the
 * span. The amount of a month still to be planned opens the amount sheet
 * through `?planear=`; an ended or archived goal offers no sheet. `listGoals`
 * rides in the fan-out for the shift sheet's «las demás metas».
 */
export async function MonthsScreen({
  goalId,
  planning,
  returnPath,
}: {
  goalId: string;
  planning: string | null;
  returnPath: string;
}) {
  const [goal, goals] = await Promise.all([loadGoal(goalId), listGoals()]);
  if (!goal) notFound();

  const t = await getTranslations();
  const open = goal.archivedAt === null && goal.endedOn === null;
  const target = goal.months.find((row) => row.current) ?? goal.months[0];
  const empty = Boolean(goal.measureUnit && goal.measureName) && goal.budgets.length === 0;
  const planHref = (month: string) => `/metas/${goal.id}/meses?planear=${month.slice(0, 7)}`;

  const unit = goal.measureUnit;
  const today = todayInZone();
  const offer = open
    ? shiftOfferNow({
        today,
        horizon: goal.horizon,
        budgets: goal.budgets,
        months: goal.months,
        phases: goal.phases,
        tasks: goal.tasks,
        shifts: goal.shifts,
      })
    : null;
  const currentPhase =
    goal.phases.find((phase) => phase.startsOn <= today && (phase.endsOn === null || today <= phase.endsOn))
      ?.name ?? null;
  const planned = open && unit
    ? goal.months.find((row) => !row.past && row.month.slice(0, 7) === planning)
    : undefined;

  return (
    <Page width="full">
      <ScreenHeader
        title={t("month.months.title")}
        back={{ href: `/metas/${goal.id}`, place: goal.name }}
      />
      {empty && open && target ? (
        <>
          <Text as="p" tone="secondary">
            {t("month.months.emptyBody", { month: monthLabel(target.month) })}
          </Text>
          <Button asChild>
            <Link href={planHref(target.month)}>
              {t("month.months.emptyAction", { month: monthLabel(target.month) })}
            </Link>
          </Button>
        </>
      ) : null}
      {target ? (
        <ListDetail
          show="list"
          list={
            <>
              <MonthsList goal={goal} open={target.month} />
              {offer ? (
                <ShiftProposal
                  compact
                  goalId={goal.id}
                  goalName={goal.name}
                  month={offer.closedMonth.slice(0, 7)}
                  plan={offer.plan}
                  currentPhase={currentPhase}
                  hasDoneTasks={goal.tasks.some((task) => task.doneOn !== null)}
                  otherGoals={goals.filter((other) => other.id !== goal.id).map((other) => other.name)}
                  see={t("month.shift.monthsAction")}
                />
              ) : null}
            </>
          }
          detail={<MonthDetail
              goal={goal}
              goals={goals}
              month={target.month.slice(0, 7)}
              from={`/metas/${goal.id}/meses`}
              heading
            />}
        />
      ) : null}
      {planned && unit ? (
        <BudgetSheet
          key={planned.month}
          goalId={goal.id}
          goalName={goal.name}
          unit={unit}
          month={planned.month.slice(0, 7)}
          monthName={monthLabel(planned.month)}
          amount={planned.planned}
          closeHref={returnPath}
        />
      ) : null}
    </Page>
  );
}
