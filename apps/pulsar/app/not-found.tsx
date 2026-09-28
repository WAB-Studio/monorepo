import { getTranslations } from "next-intl/server";

import { BottomNav } from "@/components/ui";

import AppNotFound from "./(app)/not-found";

/**
 * Any URL this app does not route at all, `/no-existe` included, and a
 * `notFound()` with no nearer boundary. Outside `app/(app)/layout.tsx`, so the
 * nav is drawn here by hand; this page's own path never matches `/`,
 * `/semana` or `/metas`, so no tab reads active. Inside the app,
 * `app/(app)/not-found.tsx` takes over and the layout's nav is the only one.
 */
export default async function NotFound() {
  const nav = await getTranslations("common.nav");

  return (
    <>
      <AppNotFound />
      <BottomNav todayLabel={nav("today")} weekLabel={nav("week")} goalLabel={nav("goal")} />
    </>
  );
}
