import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { TaskRow } from "@/components/month/task-row";
import { Button, Face, Flex, Figure, Grid, Page, Panel, ScreenHeader, SectionLabel, Separator, Text } from "@/components/ui";
import { owedAt, type MonthItem } from "@/lib/plan/carry";
import { loadMonthAcross, type MonthAcrossGoal } from "@/lib/queries/month";
import { formatQuantity, isTimeUnit, type TimeWords } from "@/lib/units/time";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * `MesTodas`, `MesTodasEscritorio`, `MesTodasVacio`, `MesTodasNada`,
 * `MesTodasHecho`, `MesTodasSinEvidencia` (RP-43, RP-31): this month of every
 * open goal, as `loadMonthAcross` reads it. Adding a task or an amount stays
 * on the goal's own month page, which each goal's name opens.
 */
export async function MonthAcrossScreen() {
  const across = await loadMonthAcross();
  const t = await getTranslations();
  const units = await getTranslations("units");
  const words: TimeWords = {
    h: (h) => units("h", { h }),
    min: (min) => units("min", { min }),
    join: (h, min) => units("join", { h, min }),
  };
  const monthNames = t.raw("day.monthLong") as string[];
  const weekdayNames = t.raw("day.weekdayLong") as string[];
  const monthName = (month: string) => monthNames[Number(month.slice(5, 7)) - 1];
  const seg = across.month.slice(0, 7);
  const thisName = monthName(across.month);
  const weekday = weekdayNames[(new Date(`${across.today}T12:00:00Z`).getUTCDay() + 6) % 7];
  const dateLine = `${weekday} ${Number(across.today.slice(8, 10))} de ${monthName(across.today)}`;

  function block(goal: MonthAcrossGoal) {
    const unit = goal.unit;
    const say = (n: number) => (unit ? formatQuantity(n, unit, words) : String(n));
    const goalHref = `/metas/${goal.id}/meses/${seg}`;
    const carried = goal.items.filter((entry) => entry.carriedFrom !== null);
    const own = goal.items.filter((entry) => entry.carriedFrom === null);
    const carriedMonths = [...new Set(carried.map((entry) => entry.carriedFrom as string))];

    const leaves = goal.items.flatMap((entry) => (entry.children.length > 0 ? entry.children : [entry.task]));
    const doneInMonth = sum(
      leaves
        .filter((task) => task.doneOn !== null && task.doneOn.slice(0, 7) === seg)
        .map((task) => task.estimate ?? 0),
    );
    const ownPlanned = sum(own.map((entry) => owedAt(entry.task, entry.children, "0000-01-01")));

    let meta: string | null = null;
    if (!goal.line) {
      meta = t(goal.items.length === 0 ? "month.across.noTasks" : "month.across.measuresNothing", {
        month: thisName,
      });
    } else if (goal.line.planned === null) {
      meta = t(goal.items.length === 0 ? "month.across.nothingPlanned" : "month.across.noAmount", {
        month: thisName,
      });
    } else if (across.evidence === "unreadable") {
      meta = t("month.declaredOnly");
    } else if (doneInMonth > 0) {
      meta = t("month.list.includesDone", { done: say(doneInMonth) });
    }

    const planLink =
      goal.line && goal.line.planned === null
        ? { href: `/metas/${goal.id}/meses?planear=${seg}`, label: t("month.planMonth", { month: thisName }) }
        : goal.items.length === 0
          ? { href: `${goalHref}/tarea/nueva`, label: t("month.across.addTask") }
          : null;

    function item(entry: MonthItem) {
      const { task, children } = entry;
      const childTotal = sum(children.map((child) => child.estimate ?? 0));
      const childDone = sum(children.filter((child) => child.doneOn !== null).map((child) => child.estimate ?? 0));
      const isParent = children.length > 0;
      const owes = entry.carriedFrom !== null ? entry.owes : isParent ? childTotal : (task.estimate ?? 0);

      let sub: string | undefined;
      if (entry.carriedFrom !== null) {
        sub = entry.hasAmount
          ? t("month.list.owes", { month: monthName(entry.carriedFrom), owes: say(entry.owes) })
          : t("month.list.fromMonth", { month: monthName(entry.carriedFrom) });
      } else if (isParent) {
        sub =
          childTotal > 0
            ? t("month.list.doneOf", { done: say(childDone), total: say(childTotal) })
            : t("month.list.doneOf", {
                done: children.filter((child) => child.doneOn !== null).length,
                total: children.length,
              });
      }

      return (
        <Flex key={task.id} direction="column">
          <TaskRow
            oneOffId={task.id}
            name={task.name}
            factId={task.factId ?? null}
            done={entry.done}
            parent={isParent}
            meta={sub}
            trailing={unit && owes > 0 ? say(owes) : undefined}
            markLabel={t("month.across.mark", { name: task.name })}
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
              markLabel={t("month.across.mark", { name: child.name })}
            />
          ))}
        </Flex>
      );
    }

    return (
      <Panel key={goal.id}>
        <Face on="phone">
          <Separator />
        </Face>
        <Flex direction="column" gap="1">
          <Text asChild variant="heading">
            <h2>
              <Flex asChild align="center" justify="between" gap="2" minHeight="48px">
                <Link href={goalHref}>
                  {goal.name}
                  <ChevronRight size={16} aria-hidden />
                </Link>
              </Flex>
            </h2>
          </Text>
          {goal.line ? (
            <Flex align="baseline" gap="2">
              <Figure value={goal.line.reached} unit={unit ?? undefined} />
              {goal.line.planned !== null ? (
                <Text variant="meta" tone="muted">
                  {t("month.months.of", { planned: say(goal.line.planned) })}
                </Text>
              ) : null}
            </Flex>
          ) : null}
          {meta ? (
            <Text as="p" variant="meta" tone="muted">
              {meta}
            </Text>
          ) : null}
          {planLink ? (
            <Button asChild variant="ghost" tone="accent">
              <Link href={planLink.href}>{planLink.label}</Link>
            </Button>
          ) : null}
        </Flex>
        {carriedMonths.map((from) => (
          <Flex key={from} direction="column">
            <SectionLabel>{t("month.list.fromMonth", { month: monthName(from) })}</SectionLabel>
            {carried.filter((entry) => entry.carriedFrom === from).map(item)}
          </Flex>
        ))}
        {own.length > 0 ? (
          <Flex direction="column">
            <SectionLabel>
              {unit && isTimeUnit(unit) && ownPlanned > 0
                ? t("month.list.ownMonth", { month: thisName, planned: say(ownPlanned) })
                : t("month.list.fromMonth", { month: thisName })}
            </SectionLabel>
            {own.map(item)}
          </Flex>
        ) : null}
      </Panel>
    );
  }

  return (
    <Page width="full">
      <ScreenHeader title={thisName.charAt(0).toUpperCase() + thisName.slice(1)} meta={dateLine} />
      {across.goals.length === 0 ? (
        <Flex direction="column" gap="3">
          <Text as="p">{t("month.across.empty.title")}</Text>
          <Button asChild tap={52} block>
            <Link href="/metas/nueva">{t("month.across.empty.create")}</Link>
          </Button>
          <Button asChild tap={52} block variant="outline">
            <Link href="/metas/importar">{t("month.across.empty.import")}</Link>
          </Button>
        </Flex>
      ) : (
        <>
          {across.evidence === "unreadable" ? (
            <>
              <Separator />
              <Text as="p" role="status">
                {t("month.across.unreadable")}
              </Text>
              <Separator />
            </>
          ) : null}
          <Grid columns={{ initial: "1", lg: "3" }} gap="6" align="start">
            {across.goals.map(block)}
          </Grid>
        </>
      )}
    </Page>
  );
}
