import { redirect } from "next/navigation";

import { ReviewScreen } from "@/components/goal/review-screen";
import { getPerson } from "@/lib/session";

// `Revision.dc.html` / `RevisionEscritorio.dc.html` (RP-17): the auth gate
// alone, the same shape `app/(app)/metas/[goalId]/page.tsx` takes —
// `ReviewScreen` owns the fetch and the screen both.
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { goalId } = await params;
  return <ReviewScreen goalId={goalId} />;
}
