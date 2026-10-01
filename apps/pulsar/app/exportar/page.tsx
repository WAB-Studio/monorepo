import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ReportScreen } from "@/components/export/report-screen";
import { loadReport } from "@/lib/queries/report";
import { getPerson } from "@/lib/session";
import { civilDateShort, todayInZone } from "@/lib/zone";

// The browser proposes the title as the PDF's file name.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("export");
  return { title: `${t("printBrand")} · ${civilDateShort(todayInZone())}` };
}

// Outside `app/(app)/` on purpose: neither the bottom nav nor `loading.tsx`
// stands on the printed page, so this page runs its own gate (RP-33).
export default async function ExportPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const report = await loadReport(todayInZone());
  return <ReportScreen report={report} />;
}
