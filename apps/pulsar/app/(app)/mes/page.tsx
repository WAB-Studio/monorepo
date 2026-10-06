import { redirect } from "next/navigation";

import { MonthAcrossScreen } from "@/components/across/month-across-screen";
import { getPerson } from "@/lib/session";

// `MesTodas.dc.html` (RP-43): the auth gate alone; `MonthAcrossScreen` owns the fetch.
export default async function MonthAcrossPage() {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  return <MonthAcrossScreen />;
}
