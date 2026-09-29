import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { BottomNav } from "@/components/ui";
import { getPerson } from "@/lib/session";
import { civilDateShort, todayInZone } from "@/lib/zone";

/**
 * The signed-in shell: the day, `/metas/**` and nothing else — `/entrar` and
 * `/auth/confirm` sit outside this group, so `app/layout.tsx` (the real root
 * layout) never calls a dynamic API and `/entrar` stays `○ static`. Every
 * page under here still runs its own `getPerson()` gate and its own
 * `redirect("/entrar")`; this layout only decides whether the nav draws,
 * never who may pass.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // No round trip: `getPerson` is `cache()`-wrapped (`lib/session.ts`), so
  // this pays the same one JWT read every page under here already does.
  const person = await getPerson();
  const t = await getTranslations("common.nav");
  const common = await getTranslations("common");
  const theme = await getTranslations("day.theme");

  return (
    <>
      {children}
      {person ? (
        <BottomNav
          todayLabel={t("today")}
          weekLabel={t("week")}
          goalLabel={t("goal")}
          appName={common("appName")}
          goalsLabel={t("goals")}
          date={civilDateShort(todayInZone())}
          theme={{ toLightLabel: theme("toLight"), toDarkLabel: theme("toDark") }}
        />
      ) : null}
    </>
  );
}
