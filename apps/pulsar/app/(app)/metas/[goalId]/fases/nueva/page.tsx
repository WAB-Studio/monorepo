import { notFound, redirect } from "next/navigation";

import { PhaseForm } from "@/components/goal/phase-form";
import { horizonWeeks, weekIndex } from "@/components/goal/phase-weeks";
import { loadGoal } from "@/lib/queries/goal";
import { getPerson } from "@/lib/session";
import { civilDateInZone } from "@/lib/zone";

/**
 * `CompromisoNuevo.dc.html`'s own shape, for a phase (RP-15): the auth gate
 * and the one query `PhaseForm` needs — the goal's own opening, horizon and
 * every phase it already has, all in `loadGoal`'s single statement
 * (`lib/queries/goal.ts`), the same shape `app/metas/[goalId]/compromisos/
 * nuevo/page.tsx` takes for a commitment. Prefills the next open span: from
 * the week after the last phase ends (1 with none), four weeks long, never
 * past the goal's own horizon.
 */
export default async function NewPhasePage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const person = await getPerson();
  if (!person) redirect("/entrar");

  const { goalId } = await params;
  const goal = await loadGoal(goalId);
  if (!goal) notFound();
  // RP-24: an archived or ended goal draws no "Añadir una fase" way in; a
  // direct visit to this route is refused the same way `listGoals` (open-only)
  // already 404s `compromisos/nuevo` for one.
  if (goal.archivedAt || goal.endedOn) notFound();

  const openedOn = civilDateInZone(new Date(goal.createdAt));
  const totalWeeks = horizonWeeks(openedOn, goal.horizon);

  const lastEndsOn = goal.phases.reduce<string | null>(
    (latest, phase) =>
      phase.endsOn !== null && (latest === null || phase.endsOn > latest) ? phase.endsOn : latest,
    null,
  );
  const defaultFromWeek = lastEndsOn ? weekIndex(openedOn, lastEndsOn) + 1 : 1;
  const defaultToWeek = Math.max(defaultFromWeek, Math.min(defaultFromWeek + 3, totalWeeks));

  return (
    <PhaseForm
      goalId={goal.id}
      goalName={goal.name}
      openedOn={openedOn}
      horizon={goal.horizon}
      defaultFromWeek={defaultFromWeek}
      defaultToWeek={defaultToWeek}
      existingPhases={goal.phases.map((phase) => ({
        startsOn: phase.startsOn,
        // `phases.ends_on` is `NOT NULL` (db/schema/phases.ts): every phase
        // this app has ever written already closes. `Phase`'s own type
        // allows an open-ended span for a future cadence this engine does
        // not yet write; a far sentinel keeps that case refusing correctly
        // — an open phase overlapping anything after its own start — rather
        // than collapsing it to a single day.
        endsOn: phase.endsOn ?? "9999-12-31",
      }))}
    />
  );
}
