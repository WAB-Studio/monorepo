import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { loadGoal } from "@/lib/queries/goal";
import { Button, Page, Table, Text, type TableRow } from "@/components/ui";

/**
 * `Revision.dc.html` / `RevisionEscritorio.dc.html` (RP-17): the goal's own
 * measure, one row per week from its opening to the week holding today —
 * `loadGoal`'s own `weeks`, drawn through `Table`'s one set of props rather
 * than two markups. `null` reads as "not there" (`loadGoal`'s own contract,
 * `lib/queries/goal.ts`) and is the only failure this screen catches; every
 * other rejection reaches the error boundary — no `.catch` here, unlike
 * `goal-screen.tsx`'s own sibling routes.
 */
export async function ReviewScreen({ goalId }: { goalId: string }) {
  const goal = await loadGoal(goalId);
  if (!goal) notFound();

  const t = await getTranslations();

  // §0.3, 3: a goal whose first quantity commitment has not landed yet has
  // nothing to sum and nothing to place in a week (RP-14's own rule, carried
  // here). No table for a measure that does not exist.
  if (!goal.measureUnit || !goal.measureName) {
    return (
      <Page>
        <Text as="p" variant="meta" tone="muted">
          {goal.name}
        </Text>
        <Text as="p" tone="secondary">
          {t("goal.review.noMeasure")}
        </Text>
        <Button asChild variant="ghost">
          <Link href={`/metas/${goal.id}`}>{t("goal.review.back")}</Link>
        </Button>
      </Page>
    );
  }

  const columns = [
    t("goal.review.columns.week"),
    goal.measureName,
    t("goal.review.columns.phase"),
    t("goal.review.columns.note"),
  ];

  const rows: TableRow[] = goal.weeks.map((week) => {
    const note = week.current ? t("goal.review.current") : "";
    return {
      key: String(week.index),
      cells: [t("goal.review.weekLabel", { n: week.index }), week.total, week.phaseName ?? "", note],
      note: note || undefined,
    };
  });

  const currentIndex = goal.weeks.findIndex((week) => week.current);

  return (
    <Page width="wide">
      <Text as="p" variant="meta" tone="muted">
        {goal.name}
      </Text>
      <Text as="p" variant="title">
        {goal.measureName}
      </Text>
      <Table
        caption={t("goal.review.caption")}
        columns={columns}
        rows={rows}
        figures={[1]}
        unit={goal.measureUnit}
        current={currentIndex === -1 ? undefined : currentIndex}
      />
      <Button asChild variant="ghost">
        <Link href={`/metas/${goal.id}`}>{t("goal.review.back")}</Link>
      </Button>
    </Page>
  );
}
