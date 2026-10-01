import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BudgetSheet } from "@/components/month/budget-sheet";
import { carryShare } from "@/lib/plan/carry";
import { loadGoal } from "@/lib/queries/goal";
import { formatQuantity, type TimeWords } from "@/lib/units/time";
import { Button, Page, Table, Text, type TableRow } from "@/components/ui";

const monthFormat = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" });

// "2026-10-01" as «octubre 2026».
function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}T12:00:00Z`)).replace(" de ", " ");
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
        <Button asChild variant="ghost">
          <Link href={`/metas/${goal.id}`}>{t("goal.review.back")}</Link>
        </Button>
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

    const amount = (
      <Text tone="secondary">
        {row.planned === null
          ? t("month.months.noAmount")
          : t("month.months.of", { planned: formatQuantity(row.planned, unit, words) })}
      </Text>
    );
    const state = row.current
      ? t("month.months.current")
      : share
        ? t("month.months.carried", { share: Math.floor((share.carried * 100) / share.planned) })
        : "";
    const note = (
      <>
        {open ? (
          <Text asChild tone="accent">
            <Link href={planHref(row.month)}>{amount}</Link>
          </Text>
        ) : (
          amount
        )}
        {state ? ` · ${state}` : ""}
      </>
    );

    return {
      key: row.month,
      cells: [
        <Link key="month" href={`/metas/${goal.id}/meses/${row.month.slice(0, 7)}`}>
          {label}
        </Link>,
        started ? row.reached : null,
        row.planned,
        note,
      ],
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
          t("month.months.columns.note"),
        ]}
        rows={rows}
        figures={[1, 2]}
        unit={unit}
        current={currentIndex === -1 ? undefined : currentIndex}
      />
      {open ? (
        <Text as="p" variant="meta" tone="muted">
          {t("month.months.hint")}
        </Text>
      ) : null}
      <Button asChild variant="ghost">
        <Link href={`/metas/${goal.id}`}>{t("goal.review.back")}</Link>
      </Button>
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
