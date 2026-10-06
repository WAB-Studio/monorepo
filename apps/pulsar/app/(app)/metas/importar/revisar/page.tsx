import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { ReviewScreen } from "@/components/import/review-screen";
import { listGoals } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";
import { todayInZone } from "@/lib/zone";

// Static per route: no title reads a goal or costs a statement (RNP-01).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.titles");
  return { title: t("importReview") };
}

// The auth gate, today's day and the open goals' names, for the repeated-name
// warning; the draft itself lives in the tab's storage, so the client reads it (RP-37).
export default async function ImportReviewPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const open = await listGoals();

  return <ReviewScreen today={todayInZone()} openGoalNames={open.map((goal) => goal.name)} />;
}
