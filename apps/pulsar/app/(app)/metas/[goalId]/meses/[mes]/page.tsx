import { notFound, redirect } from "next/navigation";

import { MonthScreen } from "@/components/month/month-screen";
import { getPerson } from "@/lib/session";

// `Mes`, `MesArrastre`, `MesVacio`, `MesCerrado`, `MesCorrer` (RP-30, RP-31,
// RP-32, RP-34): the auth gate and the segment's shape; `MonthScreen` owns the
// fetch and the span check. The pattern is the same one the amount sheet and
// the actions speak (`lib/validation/budget.ts`).
export default async function MonthPage({
  params,
}: {
  params: Promise<{ goalId: string; mes: string }>;
}) {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { goalId, mes } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) notFound();

  return <MonthScreen goalId={goalId} month={mes} />;
}
