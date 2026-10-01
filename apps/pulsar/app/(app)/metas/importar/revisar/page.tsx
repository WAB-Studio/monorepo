import { redirect } from "next/navigation";

import { ReviewScreen } from "@/components/import/review-screen";
import { getPerson } from "@/lib/session";
import { todayInZone } from "@/lib/zone";

// The auth gate and today's day; the draft itself lives in the tab's storage,
// so the client reads it (RP-37).
export default async function ImportReviewPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <ReviewScreen today={todayInZone()} />;
}
