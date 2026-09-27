import { redirect } from "next/navigation";

import { NewGoalForm } from "@/components/goal/new-goal-form";
import { getPerson } from "@/lib/session";

// The least it takes to open a goal (RP-11, `MetaNueva.dc.html`): the whole
// screen is `NewGoalForm`'s own — this file is the auth gate and nothing else,
// the same shape `app/page.tsx` already takes for the day.
export default async function NewGoalPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <NewGoalForm />;
}
