import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { MonthsScreen } from "@/components/month/months-screen";
import { getPerson } from "@/lib/session";

// Static per route: no title reads a goal or costs a statement (RNP-01).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.titles");
  return { title: t("months") };
}

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
