import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listGoalsForMetas } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";
import { civilDayMonthShort } from "@/lib/zone";
import { dayBefore } from "@/lib/day/weeks";
import { Button, Page, SectionLabel, Text } from "@/components/ui";

// A person with goals sees them listed one with the other — never a redirect
// past a single one, or a second goal is reachable only by typing a URL
// (RP-11: "the app holds more than one at a time"). It ends with the way into
// the import (`Exportar.dc.html`), outlined like the add-another button.
//
// With no goal ever, open, ended or archived, it draws `MetasVacio.dc.html`
// instead: the import was built for exactly this person and a redirect to
// `/metas/nueva` hid it (RP-37). An all-archived person still gets the list.
//
// RP-24: an archived goal is never in the "open" section, and lists apart
// under a quiet "Archivadas" one when there is at least one — each still its
// own way into `Meta.dc.html`, from where it reopens. An ended goal
// (`MetasTerminadas.dc.html`) lists under "terminadas" between the two.
export default async function GoalsIndexPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { open, ended, archived } = await listGoalsForMetas();
  const t = await getTranslations();

  if (open.length === 0 && ended.length === 0 && archived.length === 0) {
    return (
      <Page>
        <div>
          <Text as="p" variant="meta" tone="muted">
            {t("goal.none.eyebrow")}
          </Text>
          <Text asChild variant="title">
            <h1>{t("goal.none.title")}</h1>
          </Text>
        </div>
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

  return (
    <Page>
      <SectionLabel>{t("goal.list.title")}</SectionLabel>
      {open.map((goal) => (
        <Button key={goal.id} asChild variant="outline" block>
          <Link href={`/metas/${goal.id}`}>{goal.name}</Link>
        </Button>
      ))}
      <Button asChild variant="outline" block>
        <Link href="/metas/nueva">{t("goal.list.addAnother")}</Link>
      </Button>

      <section>
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
      </section>

      {ended.length > 0 ? (
        <section>
          <SectionLabel>{t("goal.list.endedTitle")}</SectionLabel>
          {ended.map((goal) => (
            <Button key={goal.id} asChild variant="outline" block>
              <Link href={`/metas/${goal.id}`}>
                {goal.name}
                <Text variant="meta" end>
                  {t("goal.list.endedOnShort", { date: civilDayMonthShort(dayBefore(goal.horizon)) })}
                </Text>
              </Link>
            </Button>
          ))}
        </section>
      ) : null}

      {archived.length > 0 ? (
        <section>
          <SectionLabel>{t("goal.list.archivedTitle")}</SectionLabel>
          {archived.map((goal) => (
            <Button key={goal.id} asChild variant="outline" block>
              <Link href={`/metas/${goal.id}`}>{goal.name}</Link>
            </Button>
          ))}
        </section>
      ) : null}
    </Page>
  );
}
