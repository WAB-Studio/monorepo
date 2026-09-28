import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listGoals } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";
import { Button, Page, SectionLabel } from "@/components/ui";

// No board draws this screen. It always lists the person's open goals, one
// with the other — never a redirect past a single one, or a second goal is
// reachable only by typing a URL (RP-11: "the app holds more than one at a
// time"). It ends with the same way in `commitment-list.tsx` draws under a
// goal's own commitments: outlined, since there is always at least one goal
// already open by the time this list draws at all. With none yet there is
// nothing to list and nobody to open a second goal from, so `/metas/nueva`
// is the only useful screen and this alone still redirects there.
export default async function GoalsIndexPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const goals = await listGoals();
  if (goals.length === 0) redirect("/metas/nueva");

  const t = await getTranslations();

  return (
    <Page>
      <SectionLabel>{t("goal.list.title")}</SectionLabel>
      {goals.map((goal) => (
        <Button key={goal.id} asChild variant="outline" block>
          <Link href={`/metas/${goal.id}`}>{goal.name}</Link>
        </Button>
      ))}
      <Button asChild variant="outline" block>
        <Link href="/metas/nueva">{t("goal.list.addAnother")}</Link>
      </Button>
    </Page>
  );
}
