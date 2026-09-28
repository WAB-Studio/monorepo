import { redirect } from "next/navigation";

import { WeekScreen } from "@/components/week/week-screen";
import { getPerson } from "@/lib/session";

// Same gate `app/page.tsx` runs: `app/layout.tsx` enforces no session of its
// own, so every screen redirects for itself. `getPerson` is the verified JWT
// alone, zero round trips.
export default async function WeekPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <WeekScreen />;
}
