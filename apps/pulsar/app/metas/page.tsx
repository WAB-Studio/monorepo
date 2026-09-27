import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listGoals } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";
import { Button, Page, SectionLabel } from "@/components/ui";

// No board draws this screen (it is only ever a stop on the way to one open
// goal or to opening the first): with none, `/metas/nueva`; with exactly
// one, straight to it; with several, the plain list below — composed from
// the same primitives as everything else, never a card and never a new one.
export default async function GoalsIndexPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const goals = await listGoals();
  if (goals.length === 0) redirect("/metas/nueva");
  if (goals.length === 1) redirect(`/metas/${goals[0].id}`);

  const t = await getTranslations();

  return (
    <Page>
      <SectionLabel>{t("goal.list.title")}</SectionLabel>
      {goals.map((goal) => (
        <Button key={goal.id} asChild variant="ghost" block>
          <Link href={`/metas/${goal.id}`}>{goal.name}</Link>
        </Button>
      ))}
    </Page>
  );
}
