import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { type Translator } from "@/i18n/translator";
import { dayBefore } from "@/lib/day/weeks";
import { civilSpan, goalSections, monthsWithWeeks, type Section } from "@/lib/export/sections";
import type { GoalReport, Report, ReportTask } from "@/lib/export/report";
import { civilDateToDate } from "@/lib/zone";
import {
  Figure,
  Flex,
  Mark,
  Page,
  Panel,
  PanelGrid,
  PrintBlock,
  PrintHidden,
  PrintOnly,
  PrintPage,
  ScreenHeader,
  SectionLabel,
  Separator,
  Table,
  Text,
  type TableRow,
} from "@/components/ui";

import { PrintButton } from "./print-button";

const monthYear = new Intl.DateTimeFormat("es-CO", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthOnly = new Intl.DateTimeFormat("es-CO", {
  month: "long",
  timeZone: "UTC",
});
const dateWithYear = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateWithWeekday = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// «agosto 2026»: the month and its year, without the «de» ICU puts between.
function monthLabel(day: string): string {
  const parts = monthYear.formatToParts(civilDateToDate(day));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")} ${part("year")}`;
}

function MonthFigures({
  goal,
  declaredOnly,
  month,
  t,
}: {
  goal: GoalReport;
  declaredOnly: boolean;
  month: string;
  t: Translator<"export">;
}) {
  const unit = goal.unit as string;
  return (
    <Flex direction="column" gap="1">
      <SectionLabel>{t("sections.month", { month })}</SectionLabel>
      <Figure value={goal.thisMonth.reached} unit={unit} />
      {goal.thisMonth.planned !== null ? (
        <Text variant="meta" tone="muted">
          {t("of", { planned: "" })}
          <Figure variant="meta" value={goal.thisMonth.planned} unit={unit} />
        </Text>
      ) : null}
      {declaredOnly ? (
        <Text variant="meta" tone="muted">
          {t("declaredOnly")}
        </Text>
      ) : null}
    </Flex>
  );
}

// What closes a task's row: the amount owed (a carried task still open), its
// amount, or failing both the words the board uses: how many sub-tasks are
// done, «hecha», «pendiente».
function Trailing({
  task,
  unit,
  t,
}: {
  task: ReportTask;
  unit: string | null;
  t: Translator<"export">;
}) {
  if (unit !== null && task.from !== null && !task.done && task.hasAmount) {
    return (
      <>
        {t("owes", { owes: "" })}
        <Figure variant="meta" value={task.owes} unit={unit} />
      </>
    );
  }
  const estimates = task.children.flatMap((child) => (child.estimate === null ? [] : [child.estimate]));
  const amount =
    task.children.length === 0
      ? task.estimate
      : estimates.length > 0
        ? estimates.reduce((sum, value) => sum + value, 0)
        : null;
  if (unit !== null && amount !== null) {
    return <Figure variant="meta" value={amount} unit={unit} />;
  }
  if (task.children.length > 0) {
    return t("taskProgress", {
      done: task.children.filter((child) => child.done).length,
      total: task.children.length,
    });
  }
  return task.done ? t("taskDone") : t("taskPending");
}

function TaskLine({
  name,
  done,
  meta,
  note,
  trailing,
  indented,
  t,
}: {
  name: string;
  done: boolean;
  meta?: string;
  note: string | null;
  trailing: ReactNode;
  indented?: boolean;
  t: Translator<"export">;
}) {
  return (
    <Flex gap="3" align="start" py="3" pl={indented ? "6" : "1"} pr="1">
      <Mark state={done ? "declared" : "empty"} label={done ? t("taskDone") : t("taskPending")} />
      <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
        <Text as="p" tone={done ? "muted" : "ink"}>
          {name}
        </Text>
        {meta ? (
          <Text as="p" variant="meta" tone="muted">
            {meta}
          </Text>
        ) : null}
        {note !== null ? (
          <Text as="p" tone="secondary" note>
            {note}
          </Text>
        ) : null}
      </Flex>
      <Flex flexShrink="0">
        <Text variant="meta" tone="muted">
          {trailing}
        </Text>
      </Flex>
    </Flex>
  );
}

function GoalPart({
  goal,
  declaredOnly,
  today,
  t,
}: {
  goal: GoalReport;
  declaredOnly: boolean;
  today: string;
  t: Translator<"export">;
}) {
  const unit = goal.unit;

  if (goal.endedOn !== null) {
    return (
      <PrintBlock>
        <Flex direction="column" gap="3">
          <Text asChild variant="name" rule>
            <h2>{goal.name}</h2>
          </Text>
          <Text as="p" variant="meta" tone="muted">
            {t("ended", { date: dateWithYear.format(civilDateToDate(goal.endedOn)) })}
          </Text>
          {unit !== null ? (
            <Flex direction="column" gap="1">
              <SectionLabel>{t("sections.atEnd")}</SectionLabel>
              <Figure value={goal.toDate.reached} unit={unit} />
              <Text variant="meta" tone="muted">
                {t("of", { planned: "" })}
                <Figure variant="meta" value={goal.toDate.planned} unit={unit} />
              </Text>
            </Flex>
          ) : null}
        </Flex>
      </PrintBlock>
    );
  }

  const sections = goalSections(goal);
  const until = dateWithYear.format(civilDateToDate(dayBefore(goal.horizon)));
  const thisMonth = monthOnly.format(civilDateToDate(today));

  const measureLine =
    unit === null
      ? t("noMeasure", { date: until })
      : declaredOnly
        ? t("measuresFed", { unit })
        : t("measures", { unit, date: until });

  const render = (section: Section) => {
    switch (section) {
      case "month":
        return (
          <MonthFigures goal={goal} declaredOnly={declaredOnly} month={thisMonth} t={t} />
        );
      case "toDate":
        return (
          <Flex direction="column" gap="1">
            <SectionLabel>{t("sections.toDate")}</SectionLabel>
            <Figure value={goal.toDate.reached} unit={unit as string} />
            <Text variant="meta" tone="muted">
              {t("of", { planned: "" })}
              <Figure
                variant="meta"
                value={goal.toDate.planned}
                unit={unit as string}
              />
            </Text>
          </Flex>
        );
      case "phases":
        return (
          <Flex direction="column" gap="1">
            <SectionLabel>{t("sections.phases")}</SectionLabel>
            {goal.phases.map((phase) => (
              <Text key={phase.startsOn} as="p">
                <Text>{phase.aim}</Text>
                <Text variant="meta" tone="muted">
                  {" · "}
                  {civilSpan(phase.startsOn, phase.endsOn)}
                  {phase.current ? ` · ${t("current")}` : ""}
                </Text>
              </Text>
            ))}
          </Flex>
        );
      case "tasks":
        return (
          <Flex direction="column">
            <SectionLabel>{t("sections.tasks", { month: thisMonth })}</SectionLabel>
            {goal.tasks.map((task, index) => (
              <Flex key={`${task.name}-${task.from ?? ""}-${index}`} direction="column">
                {index > 0 ? <Separator /> : null}
                <TaskLine
                  name={task.name}
                  done={task.done}
                  meta={
                    task.from !== null
                      ? t("fromMonth", { month: monthOnly.format(civilDateToDate(task.from)) })
                      : undefined
                  }
                  note={task.note}
                  trailing={<Trailing task={task} unit={unit} t={t} />}
                  t={t}
                />
                {task.children.map((child) => (
                  <Flex key={child.name} direction="column">
                    <Separator />
                    <TaskLine
                      name={child.name}
                      done={child.done}
                      note={child.note}
                      indented
                      trailing={
                        unit !== null && child.estimate !== null ? (
                          <Figure variant="meta" value={child.estimate} unit={unit} />
                        ) : child.done ? (
                          t("taskDone")
                        ) : (
                          t("taskPending")
                        )
                      }
                      t={t}
                    />
                  </Flex>
                ))}
              </Flex>
            ))}
          </Flex>
        );
      case "months": {
        const groups = monthsWithWeeks(goal);
        const rows: TableRow[] = groups.flatMap(({ month, weeks }) => {
          const started = month.current || month.past;
          const share = month.carried;
          const plannedFigure =
            month.planned === null ? null : (
              <Figure
                variant="meta"
                value={month.planned}
                unit={unit as string}
              />
            );
          const note = month.current ? (
            <>
              {plannedFigure ? t("of", { planned: "" }) : null}
              {plannedFigure}
              {plannedFigure ? " · " : null}
              {t("current")}
            </>
          ) : started ? (
            <>
              {plannedFigure ? t("of", { planned: "" }) : null}
              {plannedFigure}
              {plannedFigure && share !== null ? " · " : null}
              {share !== null ? t("carried", { share }) : null}
            </>
          ) : plannedFigure ? (
            <>
              {plannedFigure} {t("planned")}
            </>
          ) : undefined;
          const last = month.current
            ? t("current")
            : share !== null
              ? t("carried", { share })
              : !started && month.planned !== null
                ? t("planned")
                : "";
          const monthRow: TableRow = {
            key: month.month,
            cells: [
              monthLabel(month.month),
              started ? month.reached : null,
              plannedFigure,
              last,
            ],
            note,
          };
          const weekRows: TableRow[] = weeks.map((week) => ({
            key: `${month.month}-${week.index}`,
            cells: [
              <Flex key="label" as="span" pl="4">
                <Text tone="muted">
                  {`${t("weekLabel", { n: week.index })} · ${civilSpan(week.startsOn, week.endsOn)}`}
                </Text>
              </Flex>,
              week.total,
              null,
              week.current ? t("current") : "",
            ],
            note: week.current ? t("current") : undefined,
          }));
          return [monthRow, ...weekRows];
        });
        const current = rows.findIndex((row) => row.key === goal.months.find((m) => m.current)?.month);
        return (
          <Flex direction="column" gap="1">
            <SectionLabel>{t("sections.months")}</SectionLabel>
            <Table
              caption={t(
                declaredOnly ? "monthsCaptionDeclared" : "monthsCaption",
                {
                  count: goal.months.length,
                },
              )}
              columns={[
                t("columns.month"),
                declaredOnly ? t("declaredShort") : t("columns.reached"),
                t("planned"),
                "",
              ]}
              rows={rows}
              figures={[1]}
              unit={unit as string}
              nowrapLabel
              current={current === -1 ? undefined : current}
            />
          </Flex>
        );
      }
    }
  };

  const [first, ...rest] = sections;
  return (
    <Flex direction="column" gap="3">
      <PrintBlock>
        <Flex direction="column" gap="3">
          <Text asChild variant="name" rule>
            <h2>{goal.name}</h2>
          </Text>
          <Text as="p" variant="meta" tone="muted">
            {measureLine}
          </Text>
          {first ? render(first) : null}
        </Flex>
      </PrintBlock>
      {rest.map((section) => (
        <PrintBlock key={section}>{render(section)}</PrintBlock>
      ))}
    </Flex>
  );
}

/**
 * `ReporteTareas.dc.html`, `ReporteMesesSemanas.dc.html`,
 * `ReporteImpresoTareas.dc.html`, `ReporteMarcoEscritorio.dc.html` and
 * `ReporteMarcoEscritorio1024.dc.html` (RP-46), on top of `ReporteSinEvidencia.dc.html`
 * and `ReporteVacio.dc.html` (RP-46, RP-35): the whole report as one page the
 * browser prints. A goal prints the sections `goalSections` names and no
 * others, so one that measures nothing never prints a zero; a goal that has
 * ended prints its name, its last day and what it reached, and goes last.
 */
export async function ReportScreen({ report }: { report: Report }) {
  const t = await getTranslations("export");

  const back = { href: "/metas", place: t("place") };

  if (report.goals.length === 0) {
    return (
      <Page width="full">
        <PrintPage>
          <Flex direction="column" gap="3">
            <ScreenHeader
              title={t("title")}
              back={back}
              eyebrow={
                <Text as="p" variant="meta" tone="muted">
                  {t("eyebrowEmpty")}
                </Text>
              }
            />
            <Text as="p" tone="secondary">
              {t("empty")}
            </Text>
          </Flex>
        </PrintPage>
      </Page>
    );
  }

  const declaredOnly = report.evidence === "unreadable";
  const goals = [
    ...report.goals.filter((goal) => goal.endedOn === null),
    ...report.goals.filter((goal) => goal.endedOn !== null),
  ];
  const ended = report.goals.length - goals.filter((goal) => goal.endedOn === null).length;
  const count =
    ended > 0
      ? `${t("goalCount", { total: report.goals.length })} · ${t("endedCount", { ended })}`
      : t("goalCount", { total: report.goals.length });

  return (
    <Page width="full">
      <PrintPage>
        <Flex direction="column" gap="2">
          <ScreenHeader
            title={t("title")}
            back={back}
            eyebrow={
              <>
                <PrintHidden>
                  <Text as="p" variant="meta" tone="muted">
                    {t("eyebrow", { date: dateWithWeekday.format(civilDateToDate(report.today)) })}
                  </Text>
                </PrintHidden>
                <PrintOnly>
                  <Text as="p" variant="meta" tone="muted">
                    {t("printHead", {
                      brand: t("printBrand"),
                      date: dateWithYear.format(civilDateToDate(report.today)),
                    })}
                  </Text>
                </PrintOnly>
              </>
            }
            actions={<PrintButton label={t("download")} />}
          />
          <Text as="p" variant="meta" tone="muted">
            {count}
          </Text>
          {declaredOnly ? (
            <Text as="p" tone="secondary">
              {t("unreadable")}
            </Text>
          ) : null}
        </Flex>
        <PanelGrid columns={3}>
          {goals.map((goal) => (
            <Panel key={goal.id}>
              <GoalPart goal={goal} declaredOnly={declaredOnly} today={report.today} t={t} />
            </Panel>
          ))}
        </PanelGrid>
      </PrintPage>
    </Page>
  );
}
