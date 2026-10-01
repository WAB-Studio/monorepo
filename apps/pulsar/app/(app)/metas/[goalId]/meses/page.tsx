import { redirect } from "next/navigation";

import { MonthsScreen } from "@/components/month/months-screen";
import { getPerson } from "@/lib/session";

// `Meses.dc.html` / `MesesVacio.dc.html` / `MesesEscritorio` (RP-32): the auth
// gate alone; `MonthsScreen` owns the fetch. `?planear=YYYY-MM` opens the
// amount sheet on that month.
export default async function MonthsPage({
  params,
  searchParams,
}: {
  params: Promise<{ goalId: string }>;
  searchParams: Promise<{ planear?: string | string[] }>;
}) {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { goalId } = await params;
  const { planear } = await searchParams;
  return <MonthsScreen goalId={goalId} planning={typeof planear === "string" ? planear : null} />;
}
