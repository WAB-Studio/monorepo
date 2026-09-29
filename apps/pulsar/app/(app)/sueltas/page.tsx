import { redirect } from "next/navigation";

import { DaylessScreen } from "@/components/one-offs/dayless-screen";
import { getPerson } from "@/lib/session";

// Same gate as Hoy: `getPerson` is the verified JWT alone, zero round trips.
export default async function DaylessPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <DaylessScreen />;
}
