import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { goalSections } from "@/lib/export/sections";
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
  const until = civilDayMonthShort(goal.horizon);

  const measureLine =
    unit === null
      ? t("noMeasure", { date: until })
      : declaredOnly
        ? t("measuresFed", { unit })
        : t("measures", { unit, date: until });

  return (
    <PrintBlock>
      <Flex direction="column" gap="3">
        <Text as="p" variant="name">
          {goal.name}
        </Text>
        <Text as="p" variant="meta" tone="muted">
          {measureLine}
        </Text>

        {sections.map((section) => {
          switch (section) {
            case "month":
              return (
                <MonthFigures
                  key={section}
                  goal={goal}
                  declaredOnly={declaredOnly}
                  t={t}
                />
              );
            case "toDate":
              return (
                <Flex key={section} direction="column" gap="1">
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
                <Flex key={section} direction="column" gap="1">
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
                <Flex key={section} direction="column" gap="1">
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
                        {" · "}
                        {t("owes", { owes: "" })}
                        {unit === null ? (
                          item.owes
                        ) : (
                          <Figure
                            variant="meta"
                            value={item.owes}
                            unit={unit}
                          />
                        )}
                      </Text>
                      {item.children.map((child) => (
                        <Text
                          key={child.name}
                          as="p"
                          variant="meta"
                          tone="secondary"
                        >
                          <Text>{child.name}</Text>
                          {" · "}
                          {t("owes", { owes: "" })}
                          {unit === null ? (
                            child.owes
                          ) : (
                            <Figure
                              variant="meta"
                              value={child.owes}
                              unit={unit}
                            />
                          )}
                        </Text>
                      ))}
                    </Flex>
                  ))}
                </Flex>
              );
            case "months": {
              const rows: TableRow[] = goal.months.map((month) => ({
                key: month.month,
                cells: [
                  monthName.format(civilDateToDate(month.month)),
                  month.reached,
                  month.planned,
                  month.current ? t("current") : "",
                ],
                note: month.current ? t("current") : undefined,
              }));
              const current = goal.months.findIndex((month) => month.current);
              return (
                <Flex key={section} direction="column" gap="1">
                  <SectionLabel>{t("sections.months")}</SectionLabel>
                  <Table
                    caption={
                      declaredOnly ? t("declaredShort") : t("sections.months")
                    }
                    columns={[
                      declaredOnly ? t("declaredShort") : t("sections.months"),
                      unit as string,
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
                <Flex key={section} direction="column" gap="1">
                  <SectionLabel>{t("sections.weeks")}</SectionLabel>
                  <Table
                    caption={t("sections.weeks")}
                    columns={[
                      t("sections.weeks"),
                      unit as string,
                      t("sections.phases"),
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
        })}
      </Flex>
    </PrintBlock>
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
          <Text as="p" variant="meta" tone="muted">
            {t("eyebrow", { date: civilDateShort(report.today) })}
          </Text>
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
