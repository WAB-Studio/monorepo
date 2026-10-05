import { redirect } from "next/navigation";

import { GoalsScreen } from "@/components/goal/goals-screen";
import { listGoalsForMetas } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";

// A person with goals sees them listed one with the other — never a redirect
// past a single one (RP-11). With no goal ever, open, ended or archived, the
// screen draws `MetasVacio` (RP-37); an all-archived person still gets the list.
export default async function GoalsIndexPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { open, ended, archived } = await listGoalsForMetas();
  return <GoalsScreen open={open} ended={ended} archived={archived} />;
}
