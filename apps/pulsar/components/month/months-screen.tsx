import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BudgetSheet } from "@/components/month/budget-sheet";
import { ShiftProposal } from "@/components/month/task-row";
import { carryShare, monthOfTask } from "@/lib/plan/carry";
import { shiftOfferNow } from "@/lib/plan/shift-offer";
import { listGoals, loadGoal } from "@/lib/queries/goal";
import { formatQuantity, type TimeWords } from "@/lib/units/time";
import { todayInZone } from "@/lib/zone";
import { Button, Flex, Page, Table, Text, type TableRow } from "@/components/ui";

const monthFormat = new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" });

// "2026-10-01" as «octubre».
function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}T12:00:00Z`));
}

/**
 * `Meses.dc.html` / `MesesVacio.dc.html` / `MesesEscritorio` /
 * `MesesSinMedida.dc.html` / `MesesCorrer.dc.html` (RP-28, RP-31, RP-32,
 * RP-34): one row per month of the goal's span from `loadGoal`'s own `months`.
 * The amount of a month still to be planned opens the amount sheet through
 * `?planear=`; a closed month's amount is text. The month's name leads to its
 * own page. An ended or archived goal reads and offers neither the sheet, the
 * links to it nor the shift; `listGoals` rides in the fan-out for the shift
 * sheet's «las demás metas».
 */
export async function MonthsScreen({
  goalId,
  planning,
}: {
  goalId: string;
  planning: string | null;
}) {
  const [goal, goals] = await Promise.all([loadGoal(goalId), listGoals()]);
  if (!goal) notFound();

  const t = await getTranslations();
  const open = goal.archivedAt === null && goal.endedOn === null;

  if (!goal.measureUnit || !goal.measureName) {
    const counts = new Map<string, number>();
    for (const task of goal.tasks) {
      if (task.parentId !== null) continue;
      const month = monthOfTask(task);
      if (month !== null) counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    const bare: TableRow[] = goal.months.map((row) => {
      const href = `/metas/${goal.id}/meses/${row.month.slice(0, 7)}`;
      const count = counts.get(row.month) ?? 0;
      const tasks = (
        <Text tone="secondary">
          <Link href={href}>
            {count === 0
              ? t("month.months.withoutMeasure.none")
              : t("month.months.withoutMeasure.tasks", { count })}
          </Link>
        </Text>
      );
      return {
        key: row.month,
        cells: [<Link key="month" href={href}>{monthLabel(row.month)}</Link>, tasks],
        detail: row.current ? t("month.months.current") : null,
        note: tasks,
      };
    });
    const now = goal.months.findIndex((row) => row.current);
    return (
      <Page>
        <Text as="p" variant="meta" tone="muted">
          {goal.name}
        </Text>
        <Text as="p" variant="title">
          {t("month.months.title")}
        </Text>
        <Text as="p" tone="secondary">
          {t("month.months.withoutMeasure.subtitle")}
        </Text>
        <Table
          caption={t("month.months.caption", { count: goal.months.length })}
          columns={[t("month.months.columns.month"), t("month.months.withoutMeasure.columnTasks")]}
          rows={bare}
          current={now === -1 ? undefined : now}
        />
        <Text as="p" variant="meta" tone="muted">
          {t("month.months.withoutMeasure.hint")}
        </Text>
        <Flex>
          <Button asChild variant="ghost">
            <Link href={`/metas/${goal.id}`}>{t("goal.review.back")}</Link>
          </Button>
        </Flex>
      </Page>
    );
  }

  const unit = goal.measureUnit;
  const units = await getTranslations("units");
  const words: TimeWords = {
    h: (h) => units("h", { h }),
    min: (min) => units("min", { min }),
    join: (h, min) => units("join", { h, min }),
  };
  const today = todayInZone();
  const offer = open
    ? shiftOfferNow({
        today,
        horizon: goal.horizon,
        budgets: goal.budgets,
        phases: goal.phases,
        tasks: goal.tasks,
        shifts: goal.shifts,
      })
    : null;
  const planHref = (month: string) => `/metas/${goal.id}/meses?planear=${month.slice(0, 7)}`;

  const currentPhase =
    goal.phases.find((phase) => phase.startsOn <= today && (phase.endsOn === null || today <= phase.endsOn))
      ?.name ?? null;

  const rows: TableRow[] = goal.months.map((row) => {
    const label = monthLabel(row.month);
    const started = row.past || row.current;
    const share = row.past ? carryShare(goal.tasks, row.month.slice(0, 7) + "-01") : null;

    const figure =
      row.planned === null ? null : formatQuantity(row.planned, unit, words);
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
    const note = open && !row.past ? (
      <Text asChild tone="accent">
        <Link href={planHref(row.month)}>{amount}</Link>
      </Text>
    ) : (
      amount
    );

    return {
      key: row.month,
      cells: [
        <Link key="month" href={`/metas/${goal.id}/meses/${row.month.slice(0, 7)}`}>
          {label}
        </Link>,
        started ? row.reached : null,
        note,
      ],
      detail:
        offer && row.month === offer.closedMonth ? (
          <Flex as="span" direction="column" align="start">
            <span>{state}</span>
            <ShiftProposal
              compact
              goalId={goal.id}
              goalName={goal.name}
              month={row.month.slice(0, 7)}
              plan={offer.plan}
              currentPhase={currentPhase}
              hasDoneTasks={goal.tasks.some((task) => task.doneOn !== null)}
              otherGoals={goals.filter((other) => other.id !== goal.id).map((other) => other.name)}
              see={t("month.shift.monthsAction")}
            />
          </Flex>
        ) : (
          state
        ),
      note,
    };
  });

  const currentIndex = goal.months.findIndex((row) => row.current);
  const empty = goal.budgets.length === 0;
  const target = goal.months.find((row) => row.current) ?? goal.months[0];

  const planned = open
    ? goal.months.find((row) => !row.past && row.month.slice(0, 7) === planning)
    : undefined;

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {goal.name}
      </Text>
      <Text as="p" variant="title">
        {t("month.months.title")}
      </Text>
      <Text as="p" tone="secondary">
        {t("month.months.subtitle")}
      </Text>
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
      <Table
        caption={t("month.months.caption", { count: goal.months.length })}
        columns={[
          t("month.months.columns.month"),
          t("month.months.columns.reached"),
          t("month.months.columns.planned"),
        ]}
        rows={rows}
        figures={[1]}
        unit={unit}
        current={currentIndex === -1 ? undefined : currentIndex}
      />
      {open ? (
        <Text as="p" variant="meta" tone="muted">
          {t("month.months.hint")}
        </Text>
      ) : null}
      <Flex>
        <Button asChild variant="ghost">
          <Link href={`/metas/${goal.id}`}>{t("goal.review.back")}</Link>
        </Button>
      </Flex>
      {planned ? (
        <BudgetSheet
          key={planned.month}
          goalId={goal.id}
          goalName={goal.name}
          unit={unit}
          month={planned.month.slice(0, 7)}
          monthName={monthLabel(planned.month)}
          amount={planned.planned}
          closeHref={`/metas/${goal.id}/meses`}
        />
      ) : null}
    </Page>
  );
}
