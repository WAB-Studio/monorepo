import { redirect } from "next/navigation";

import { ImportScreen } from "@/components/import/import-screen";
import { getPerson } from "@/lib/session";

// The auth gate and nothing else: the whole screen is `ImportScreen`'s (RP-37).
export default async function ImportPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <ImportScreen />;
}
