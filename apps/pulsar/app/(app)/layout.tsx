import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { BottomNav } from "@/components/ui";
import { listGoals } from "@/lib/queries/goal";
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
  // The rail names the open goals; a failed read draws it without them.
  const goals = person ? await listGoals().catch(() => []) : [];
  const t = await getTranslations("common.nav");
  const common = await getTranslations("common");
  const theme = await getTranslations("day.theme");

  return (
    <>
      {children}
      {person ? (
        <BottomNav
          labels={{ today: t("today"), week: t("week"), month: t("month"), goals: t("goals") }}
          appName={common("appName")}
          goals={goals.map((goal) => ({ id: goal.id, name: goal.name }))}
          goalsSectionLabel={t("goalsSection")}
          date={civilDateShort(todayInZone())}
          theme={{ toLightLabel: theme("toLight"), toDarkLabel: theme("toDark") }}
        />
      ) : null}
    </>
  );
}
