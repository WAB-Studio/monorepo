import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listGoalsForMetas } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";
import { civilDayMonthShort } from "@/lib/zone";
import { dayBefore } from "@/lib/day/weeks";
import { Button, Page, SectionLabel, Text } from "@/components/ui";

// No board draws this screen. It always lists the person's open goals, one
// with the other — never a redirect past a single one, or a second goal is
// reachable only by typing a URL (RP-11: "the app holds more than one at a
// time"). It ends with the same way in `commitment-list.tsx` draws under a
// goal's own commitments: outlined, since there is always at least one goal
// already open by the time this list draws at all. With none yet there is
// nothing to list and nobody to open a second goal from, so `/metas/nueva`
// is the only useful screen and this alone still redirects there.
//
// RP-24: an archived goal is never in the "open" section, and lists apart
// under a quiet "Archivadas" one when there is at least one — each still its
// own way into `Meta.dc.html`, from where it reopens. The redirect to
// `/metas/nueva` only fires when the person has never opened a goal at all,
// open, ended or archived: an all-archived person still lands here, not there.
// An ended goal (`MetasTerminadas.dc.html`) lists under "terminadas" between
// the two, and counts against the redirect the same way.
export default async function GoalsIndexPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { open, ended, archived } = await listGoalsForMetas();
  if (open.length === 0 && ended.length === 0 && archived.length === 0) {
    redirect("/metas/nueva");
  }

  const t = await getTranslations();

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
