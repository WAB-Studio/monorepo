import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { dayBefore } from "@/lib/day/weeks";
import { goalSections, type Section } from "@/lib/export/sections";
import type { GoalReport, Report } from "@/lib/export/report";
import {
  civilDateToDate,
  civilDayMonthShort,
  civilDateShort,
} from "@/lib/zone";
import {
  Button,
  Figure,
  Flex,
  Page,
  PrintBlock,
  PrintHidden,
  PrintOnly,
  PrintPage,
  SectionLabel,
  Table,
  Text,
  type TableRow,
} from "@/components/ui";

import { PrintButton } from "./print-button";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

const monthName = new Intl.DateTimeFormat("es-CO", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateWithYear = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const spanFormat = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function MonthFigures({
  goal,
  declaredOnly,
  t,
}: {
  goal: GoalReport;
  declaredOnly: boolean;
  t: Translator;
}) {
  const unit = goal.unit as string;
  return (
    <Flex direction="column" gap="1">
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

function Owes({
  owes,
  unit,
  t,
}: {
  owes: number;
  unit: string | null;
  t: Translator;
}) {
  return (
    <>
      {" · "}
      {t("owes", { owes: "" })}
      {unit === null ? (
        owes
      ) : (
        <Figure variant="meta" value={owes} unit={unit} />
      )}
    </>
  );
}

function GoalPart({
  goal,
  declaredOnly,
  t,
}: {
  goal: GoalReport;
  declaredOnly: boolean;
  t: Translator;
}) {
  const sections = goalSections(goal);
  const unit = goal.unit;
  const until = civilDayMonthShort(dayBefore(goal.horizon));

  const measureLine =
    unit === null
      ? t("noMeasure", { date: until })
      : declaredOnly
        ? t("measuresFed", { unit })
        : t("measures", { unit, date: until });

  const render = (section: Section) => {
    switch (section) {
      case "month":
        return <MonthFigures goal={goal} declaredOnly={declaredOnly} t={t} />;
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
                  {spanFormat.formatRange(
                    civilDateToDate(phase.startsOn),
                    civilDateToDate(phase.endsOn),
                  )}
                  {phase.current ? ` · ${t("current")}` : ""}
                </Text>
              </Text>
            ))}
          </Flex>
        );
      case "carried":
        return (
          <Flex direction="column" gap="1">
            <SectionLabel>{t("sections.carried")}</SectionLabel>
            {goal.carried.map((item) => (
              <Flex
                key={`${item.name}-${item.from}`}
                direction="column"
                gap="1"
              >
                <Text as="p">{item.name}</Text>
                <Text as="p" variant="meta" tone="muted">
                  {t("fromMonth", {
                    month: monthName.format(civilDateToDate(item.from)),
                  })}
                  {item.hasAmount ? (
                    <Owes owes={item.owes} unit={unit} t={t} />
                  ) : null}
                </Text>
                {item.children.map((child) => (
                  <Text key={child.name} as="p" variant="meta" tone="secondary">
                    <Text>{child.name}</Text>
                    {child.hasAmount ? (
                      <Owes owes={child.owes} unit={unit} t={t} />
                    ) : null}
                  </Text>
                ))}
              </Flex>
            ))}
          </Flex>
        );
      case "months": {
        const rows: TableRow[] = goal.months.map((month) => {
          const started = month.current || month.past;
          const share = month.carried;
          const last = month.current
            ? t("current")
            : share !== null
              ? t("carried", { share })
              : !started && month.planned !== null
                ? t("planned")
                : "";
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
          return {
            key: month.month,
            cells: [
              monthName.format(civilDateToDate(month.month)),
              started ? month.reached : null,
              month.planned,
              last,
            ],
            note,
          };
        });
        const current = goal.months.findIndex((month) => month.current);
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
              figures={[1, 2]}
              unit={unit as string}
              current={current === -1 ? undefined : current}
            />
          </Flex>
        );
      }
      case "weeks": {
        const rows: TableRow[] = goal.weeks.map((week) => ({
          key: String(week.index),
          cells: [
            t("weekLabel", { n: week.index }),
            week.total,
            week.phaseName ?? "",
            week.current ? t("current") : "",
          ],
          note: week.current ? t("current") : undefined,
          detail: spanFormat.formatRange(
            civilDateToDate(week.startsOn),
            civilDateToDate(week.endsOn),
          ),
        }));
        const current = goal.weeks.findIndex((week) => week.current);
        return (
          <Flex direction="column" gap="1">
            <SectionLabel>{t("sections.weeks")}</SectionLabel>
            <Table
              caption={t("weeksCaption", { count: goal.weeks.length })}
              columns={[
                t("columns.week"),
                t("columns.total"),
                t("columns.phase"),
                "",
              ]}
              rows={rows}
              figures={[1]}
              unit={unit as string}
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
          <Text as="p" variant="name">
            {goal.name}
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
 * `Reporte.dc.html`, `ReporteImpreso.dc.html`, `ReporteSinEvidencia.dc.html`
 * and `ReporteVacio.dc.html` (RP-33, RP-35): the whole report as one page the
 * browser prints. A goal prints the sections `goalSections` names and no
 * others, so one that measures nothing never prints a zero.
 */
export async function ReportScreen({ report }: { report: Report }) {
  const t = await getTranslations("export");

  if (report.goals.length === 0) {
    return (
      <Page>
        <PrintPage>
          <Flex direction="column" gap="3">
            <Text as="p" variant="meta" tone="muted">
              {t("eyebrowEmpty")}
            </Text>
            <Text as="p" tone="secondary">
              {t("empty")}
            </Text>
            <Button asChild variant="ghost">
              <Link href="/metas">{t("back")}</Link>
            </Button>
          </Flex>
        </PrintPage>
      </Page>
    );
  }

  const declaredOnly = report.evidence === "unreadable";

  return (
    <Page>
      <PrintPage>
        <Flex direction="column" gap="2">
          <PrintHidden>
            <Text as="p" variant="meta" tone="muted">
              {t("eyebrow", { date: civilDateShort(report.today) })}
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
          <Text as="p" variant="title">
            {t("title")}
          </Text>
          <Text as="p" variant="meta" tone="muted">
            {t("openGoals", { count: report.goals.length })}
          </Text>
          {declaredOnly ? (
            <Text as="p" tone="secondary">
              {t("unreadable")}
            </Text>
          ) : null}
          <PrintButton label={t("download")} />
        </Flex>
        {report.goals.map((goal) => (
          <GoalPart
            key={goal.id}
            goal={goal}
            declaredOnly={declaredOnly}
            t={t}
          />
        ))}
      </PrintPage>
    </Page>
  );
}
