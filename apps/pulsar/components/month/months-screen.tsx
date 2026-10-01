import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BudgetSheet } from "@/components/month/budget-sheet";
import { carryShare } from "@/lib/plan/carry";
import { loadGoal } from "@/lib/queries/goal";
import { formatQuantity, type TimeWords } from "@/lib/units/time";
import { Button, Flex, Page, Table, Text, type TableRow } from "@/components/ui";

const monthFormat = new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" });

// "2026-10-01" as «octubre».
function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}T12:00:00Z`));
}

/**
 * `Meses.dc.html` / `MesesVacio.dc.html` / `MesesEscritorio` (RP-32): one row
 * per month of the goal's span from `loadGoal`'s own `months`. The amount in
 * each row opens the amount sheet through `?planear=`, the same door the
 * query parameter gives; the month's name leads to its own page. An ended or
 * archived goal reads and offers neither the sheet nor the links to it.
 */
export async function MonthsScreen({
  goalId,
  planning,
}: {
  goalId: string;
  planning: string | null;
}) {
  const goal = await loadGoal(goalId);
  if (!goal) notFound();

  const t = await getTranslations();

  if (!goal.measureUnit || !goal.measureName) {
    return (
      <Page>
        <Text as="p" variant="meta" tone="muted">
          {goal.name}
        </Text>
        <Text as="p" tone="secondary">
          {t("month.errors.noMeasure")}
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
  const open = goal.archivedAt === null && goal.endedOn === null;
  const planHref = (month: string) => `/metas/${goal.id}/meses?planear=${month.slice(0, 7)}`;

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
    const note = open ? (
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
      detail: state,
      note,
    };
  });

  const currentIndex = goal.months.findIndex((row) => row.current);
  const empty = goal.budgets.length === 0;
  const target = goal.months.find((row) => row.current) ?? goal.months[0];

  const planned = open ? goal.months.find((row) => row.month.slice(0, 7) === planning) : undefined;

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
