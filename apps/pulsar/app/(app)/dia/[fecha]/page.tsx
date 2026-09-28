import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { DayScreen, oldestPastDay } from "@/components/day/day-screen";
import { getPerson } from "@/lib/session";
import { isCivilDate, todayInZone } from "@/lib/zone";

const fechaSchema = z.string().refine(isCivilDate);

// `DiaPasado.dc.html` (RP-06): a day already past, as its own screen. The
// same window `declareFact` enforces, so the route never draws a day whose
// rows could not be written: not a date, a day still to come, or one more
// than `PAST_DAY_LIMIT` back is not found; today is `/` itself.
export default async function PastDayPage({ params }: { params: Promise<{ fecha: string }> }) {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { fecha } = await params;
  const parsed = fechaSchema.safeParse(fecha);
  if (!parsed.success) notFound();

  const day = parsed.data;
  const today = todayInZone();
  if (day === today) redirect("/");
  if (day > today || day < oldestPastDay(today)) notFound();

  return <DayScreen day={day} />;
}
