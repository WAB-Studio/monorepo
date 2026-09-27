import { redirect } from "next/navigation";

import { GoalScreen } from "@/components/goal/goal-screen";
import { getPerson } from "@/lib/session";

// `Meta.dc.html`: the auth gate alone, the same shape `app/page.tsx` and
// `app/metas/nueva/page.tsx` already take — `GoalScreen` owns the fetch and
// the screen both.
export default async function GoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { goalId } = await params;
  return <GoalScreen goalId={goalId} />;
}
