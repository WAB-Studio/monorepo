import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ShiftProposal, TaskRow } from "@/components/month/task-row";
import { MonthsList } from "@/components/month/months-screen";
import { Button, Flex, Figure, ListDetail, Mark, Page, ScreenHeader, SectionLabel, Separator, Text } from "@/components/ui";
import { carryShare, monthList, owedAt, type MonthItem, type Task } from "@/lib/plan/carry";
import { nextMonth } from "@/lib/plan/months";
import { shiftOffered, shiftPlan } from "@/lib/plan/shift";
import { listGoals, loadGoal, type GoalSummary, type GoalView } from "@/lib/queries/goal";
import { formatQuantity, type TimeWords } from "@/lib/units/time";
import { todayInZone } from "@/lib/zone";

const monthFormat = new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" });

function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sum(tasks: Task[], pick: (task: Task) => number): number {
  return tasks.reduce((total, task) => total + pick(task), 0);
}

/** The dashed-circle link that closes a list: «Otra tarea», or, indented as the children, «Otra sub-tarea». */
function AddRow({ href, label, child }: { href: string; label: string; child?: boolean }) {
  return (
    <Flex align="center" gap="3" minHeight="48px" ml={child ? "30px" : undefined}>
      <Mark state="empty" dashed />
      <Text asChild tone="accent">
        <Link href={href}>{label}</Link>
      </Text>
    </Flex>
  );
}

/**
 * `Mes`, `MesArrastre`, `MesVacio`, `MesCerrado`, `MesCorrer` (RP-30, RP-31,
 * RP-32, RP-34): the month's own content, as `loadGoal`'s `months` and 126's
 * `monthList` read it (carried ones first), the closed month's share from
 * `carryShare`, and the proposal from 142's `shiftOffered` and `shiftPlan`.
 * `heading` draws the month's name as an `h2`, for the screen whose `h1` is
 * the list's title (`MesesListaDetalle.dc.html`).
 */
export async function MonthDetail({
  goal,
  goals,
  month,
  heading,
}: {
  goal: GoalView;
  goals: GoalSummary[];
  month: string;
  heading?: boolean;
}) {
  const mes = `${month}-01`;
  const row = goal.months.find((entry) => entry.month === mes);
  if (!row) notFound();

  const t = await getTranslations();
  const units = await getTranslations("units");
  const words: TimeWords = {
    h: (h) => units("h", { h }),
    min: (min) => units("min", { min }),
    join: (h, min) => units("join", { h, min }),
  };
  const today = todayInZone();
  const name = monthLabel(mes);
  const unit = goal.measureUnit;
  const say = (n: number) => (unit ? formatQuantity(n, unit, words) : String(n));
  const open = goal.archivedAt === null && goal.endedOn === null;
  const closed = row.past;
  const addHref = `/metas/${goal.id}/meses/${month}/tarea/nueva`;

  const items = monthList(goal.tasks, mes, today);
  const carried = items.filter((item) => item.carriedFrom !== null);
  const own = items.filter((item) => item.carriedFrom === null);
  const share = closed ? carryShare(goal.tasks, mes) : null;

  const doneInMonth = sum(
    goal.tasks.filter(
      (task) =>
        task.doneOn !== null &&
        task.doneOn.slice(0, 7) === month &&
        !goal.tasks.some((other) => other.parentId === task.id),
    ),
    (task) => task.estimate ?? 0,
  );

  const planned =
    row.planned === null ? t("month.noPlan") : t("month.months.of", { planned: say(row.planned) });
  const label = closed ? t("month.list.closed") : row.current ? t("month.list.thisMonth") : t("month.months.planned");
  let note: string | null = null;
  if (closed) {
    note = share
      ? t("month.list.closedLine", {
          share: Math.floor((share.carried * 100) / share.planned),
          owed: say(share.carried),
          planned: say(share.planned),
        })
      : null;
  } else if (doneInMonth > 0) {
    note = t("month.list.includesDone", { done: say(doneInMonth) });
  }

  function item(entry: MonthItem) {
    const { task, children } = entry;
    const childTotal = sum(children, (child) => child.estimate ?? 0);
    const childDone = sum(
      children.filter((child) => child.doneOn !== null),
      (child) => child.estimate ?? 0,
    );
    const isParent = children.length > 0;
    const owes = entry.carriedFrom !== null ? entry.owes : isParent ? childTotal : (task.estimate ?? 0);

    let meta: string | undefined;
    if (entry.carriedFrom !== null) {
      meta = entry.hasAmount
        ? t("month.list.owes", { month: monthLabel(entry.carriedFrom), owes: say(entry.owes) })
        : t("month.list.fromMonth", { month: monthLabel(entry.carriedFrom) });
    } else if (isParent) {
      meta = childTotal > 0 ? t("month.list.doneOf", { done: say(childDone), total: say(childTotal) }) : undefined;
    } else if (closed && !entry.done) {
      meta = t("month.list.staysIn", { month: monthLabel(nextMonth(mes)) });
    }

    // The form's own rule (`tarea/nueva/page.tsx`): an open month's own parent, no day, no time, nothing done.
    const subtaskable =
      open &&
      !closed &&
      entry.carriedFrom === null &&
      task.parentId === null &&
      task.plannedMonth?.slice(0, 7) === month &&
      task.day === null &&
      task.estimate === null &&
      task.doneOn === null;

    return (
      <Flex key={task.id} direction="column">
        <TaskRow
          oneOffId={task.id}
          name={task.name}
          factId={task.factId ?? null}
          done={entry.done}
          parent={isParent}
          meta={meta}
          trailing={unit && owes > 0 ? say(owes) : undefined}
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
          />
        ))}
        {subtaskable ? (
          <AddRow child href={`${addHref}?padre=${task.id}`} label={t("month.list.addSubtask")} />
        ) : null}
      </Flex>
    );
  }

  const carriedMonths = [...new Set(carried.map((entry) => entry.carriedFrom as string))];
  const ownPlanned = sum(
    own.map((entry) => entry.task),
    (task) => owedAt(task, goal.tasks.filter((other) => other.parentId === task.id), "0000-01-01"),
  );
  const empty = items.length === 0;

  const offered =
    open &&
    closed &&
    shiftOffered({ month: mes, today, share, shifted: goal.shifts });
  const plan = offered
    ? shiftPlan({
        closedMonth: mes,
        today,
        horizon: goal.horizon,
        budgets: goal.budgets,
        phases: goal.phases.flatMap((phase) =>
          phase.endsOn === null
            ? []
            : [{ id: phase.id, aim: phase.name, startsOn: phase.startsOn, endsOn: phase.endsOn }],
        ),
        tasks: goal.tasks,
      })
    : null;
  const currentPhase =
    goal.phases.find((phase) => phase.startsOn <= today && (phase.endsOn === null || today <= phase.endsOn))
      ?.name ?? null;
  const lastDayOfToday = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0, 12),
  );

  return (
    <Flex direction="column" gap="5" maxWidth="720px">
      {heading ? (
        <Text asChild variant="title">
          <h2>{capitalised(name)}</h2>
        </Text>
      ) : null}
      {unit ? (
        <Flex direction="column" gap="1">
          <SectionLabel>{label}</SectionLabel>
          <Flex align="baseline" gap="2">
            <Figure value={row.reached} unit={unit} />
            {open && !closed ? (
              <Text asChild tone="accent">
                <Link href={`/metas/${goal.id}/meses?planear=${month}`}>{planned}</Link>
              </Text>
            ) : (
              <Text tone="secondary">{planned}</Text>
            )}
          </Flex>
          {note ? (
            <Text as="p" variant="meta" tone="muted">
              {note}
            </Text>
          ) : null}
        </Flex>
      ) : (
        <Text as="p" tone="secondary">
          {t("month.list.noMeasure")}
        </Text>
      )}
      <Separator />

      {carriedMonths.map((from) => (
        <Flex key={from} direction="column">
          <SectionLabel>{t("month.list.fromMonth", { month: monthLabel(from) })}</SectionLabel>
          {carried.filter((entry) => entry.carriedFrom === from).map(item)}
        </Flex>
      ))}

      {empty && open && !closed ? (
        <Flex direction="column" gap="3" align="start">
          <SectionLabel>{t("month.list.tasks")}</SectionLabel>
          <Text as="p" tone="secondary">
            {t(unit ? "month.list.empty" : "month.list.emptyNoMeasure", { month: capitalised(name) })}
          </Text>
          <Button asChild>
            <Link href={addHref}>{t("month.list.emptyAction")}</Link>
          </Button>
        </Flex>
      ) : null}

      {own.length > 0 || (empty && (!open || closed)) ? (
        <Flex direction="column">
          <SectionLabel>
            {closed || !unit || ownPlanned === 0
              ? t("month.list.tasks")
              : carried.length > 0
                ? t("month.list.ownMonth", { month: name, planned: say(ownPlanned) })
                : t("month.list.tasksPlanned", { planned: say(ownPlanned) })}
          </SectionLabel>
          {own.map(item)}
        </Flex>
      ) : null}

      {open && !closed && !empty ? (
        <AddRow href={addHref} label={t("month.list.addTask", { month: name })} />
      ) : null}

      {closed ? (
        <Text as="p" variant="meta" tone="muted">
          {t("month.list.closedNote")}
        </Text>
      ) : null}

      {plan ? (
        <ShiftProposal
          goalId={goal.id}
          goalName={goal.name}
          month={month}
          plan={plan}
          currentPhase={currentPhase}
          hasDoneTasks={goal.tasks.some((task) => task.doneOn !== null)}
          otherGoals={goals.filter((other) => other.id !== goal.id).map((other) => other.name)}
          proposal={t("month.shift.proposal", { month: name })}
          see={t("month.shift.see")}
          until={t("month.shift.until", { date: dayFormat.format(lastDayOfToday) })}
        />
      ) : null}
    </Flex>
  );
}

/**
 * `ArmazonEncabezado.dc.html` case 2 (RP-31, RP-32): the month screen. The
 * header names the month and leads back to the goal, with «Todos los meses»
 * for the phone; from 1024 `ListDetail` draws the goal's months beside it, the
 * month open.
 */
export async function MonthScreen({ goalId, month }: { goalId: string; month: string }) {
  const [goal, goals] = await Promise.all([loadGoal(goalId), listGoals()]);
  if (!goal) notFound();
  const mes = `${month}-01`;
  if (!goal.months.some((entry) => entry.month === mes)) notFound();

  const t = await getTranslations();
  return (
    <Page width="full">
      <ScreenHeader
        title={capitalised(monthLabel(mes))}
        back={{ href: `/metas/${goal.id}`, place: goal.name }}
        eyebrow={
          <Button asChild tap={44} variant="ghost">
            <Link href={`/metas/${goal.id}/meses`}>
              <Text variant="meta" tone="accent">
                {t("month.list.allMonths")}
              </Text>
            </Link>
          </Button>
        }
      />
      <ListDetail
        show="detail"
        list={<MonthsList goal={goal} open={mes} />}
        detail={<MonthDetail goal={goal} goals={goals} month={month} />}
      />
    </Page>
  );
}
