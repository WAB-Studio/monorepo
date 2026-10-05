import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Button, Flex, Page, Panel, Row, ScreenHeader, SectionLabel, Split, Text } from "@/components/ui";
import { dayBefore } from "@/lib/day/weeks";
import type { GoalSummary } from "@/lib/queries/goal";
import { civilDateInZone, civilDayMonthShort, todayInZone } from "@/lib/zone";

/**
 * `MetasCentro`, `MetasCentroEscritorio` and `MetasVacio` (RP-11, RP-24, RP-27,
 * RP-37): the goals, and «el plan» inside them. The page fetches; this draws.
 * `connect` is the slot after «Exportar» where «Conectar una IA» goes.
 */
export async function GoalsScreen({
  open,
  ended,
  archived,
  connect,
}: {
  open: GoalSummary[];
  ended: GoalSummary[];
  archived: GoalSummary[];
  connect?: ReactNode;
}) {
  const t = await getTranslations();

  if (open.length === 0 && ended.length === 0 && archived.length === 0) {
    return (
      <Page>
        <ScreenHeader eyebrow={t("goal.none.eyebrow")} title={t("goal.none.title")} />
        <Text as="p" tone="secondary">
          {t("goal.none.body")}
        </Text>
        <Button asChild block>
          <Link href="/metas/nueva">{t("goal.none.action")}</Link>
        </Button>
        <section>
          <SectionLabel>{t("export.entry.section")}</SectionLabel>
          <Button asChild variant="outline" block>
            <Link href="/metas/importar">
              {t("import.entry.title")}
              <Text variant="meta" end>
                {t("import.entry.hint")}
              </Text>
            </Link>
          </Button>
        </section>
      </Page>
    );
  }

  const thisYear = todayInZone().slice(0, 4);
  const lastDay = (goal: GoalSummary) => {
    const day = dayBefore(goal.horizon);
    const date = civilDayMonthShort(day);
    return day.slice(0, 4) === thisYear ? date : `${date} ${day.slice(0, 4)}`;
  };
  const archivedLine = (goal: GoalSummary) =>
    goal.archivedAt
      ? t("goal.list.archivedOnShort", { date: civilDayMonthShort(civilDateInZone(new Date(goal.archivedAt))) })
      : undefined;
  const chevron = <ChevronRight size={16} strokeWidth={1.5} aria-hidden />;

  return (
    <Page width="full">
      <ScreenHeader title={t("common.nav.goals")} />
      <Split
        aside={380}
        main={
          <>
            <Panel as="div">
              <SectionLabel>{t("goal.list.openTitle")}</SectionLabel>
              <Flex direction="column" role="group" aria-label={t("goal.list.openTitle")}>
                {open.map((goal) => (
                  <Row
                    key={goal.id}
                    href={`/metas/${goal.id}`}
                    name={goal.name}
                    meta={t("goal.list.untilShort", { date: lastDay(goal) })}
                    trailing={chevron}
                  />
                ))}
              </Flex>
              <Button asChild variant="outline" block>
                <Link href="/metas/nueva">{t("goal.list.addAnother")}</Link>
              </Button>
            </Panel>

            {ended.length > 0 ? (
              <Panel>
                <SectionLabel>{t("goal.list.endedTitle")}</SectionLabel>
                <Flex direction="column">
                  {ended.map((goal) => (
                    <Row
                      key={goal.id}
                      href={`/metas/${goal.id}`}
                      name={goal.name}
                      meta={t("goal.list.endedOnShort", { date: civilDayMonthShort(dayBefore(goal.horizon)) })}
                      trailing={chevron}
                    />
                  ))}
                </Flex>
              </Panel>
            ) : null}

            {archived.length > 0 ? (
              <Panel>
                <SectionLabel>{t("goal.list.archivedTitle")}</SectionLabel>
                <Flex direction="column">
                  {archived.map((goal) => (
                    <Row
                      key={goal.id}
                      href={`/metas/${goal.id}`}
                      name={goal.name}
                      meta={archivedLine(goal)}
                      trailing={chevron}
                    />
                  ))}
                </Flex>
              </Panel>
            ) : null}
          </>
        }
        after={
          <Panel>
            <SectionLabel>{t("export.entry.section")}</SectionLabel>
            {open.length + ended.length > 0 ? (
              <Button asChild variant="outline" block>
                <Link href="/exportar">
                  {t("export.entry.title")}
                  <Text variant="meta" end>
                    {t("export.entry.hint")}
                  </Text>
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" block>
              <Link href="/metas/importar">
                {t("import.entry.title")}
                <Text variant="meta" end>
                  {t("import.entry.hint")}
                </Text>
              </Link>
            </Button>
            {connect}
          </Panel>
        }
      />
    </Page>
  );
}
