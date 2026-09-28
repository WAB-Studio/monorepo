import { getTranslations } from "next-intl/server";

import { Page, SectionLabel, Text } from "@/components/ui";
import { phaseOn } from "@/lib/day/derive";
import type { DaySlot } from "@/lib/day/types";
import { loadDay, type CommitmentInfo, type OneOffSummary } from "@/lib/queries/day";
import { civilDateToDate, todayInZone } from "@/lib/zone";

import { DayHeader } from "./day-header";
import { DayRow } from "./day-row";
import { EmptyDay } from "./empty-day";
import { EvidenceNote } from "./evidence-note";
import { NewOneOff } from "./new-one-off";
import { OneOffRow } from "./one-off-row";

type Translate = Awaited<ReturnType<typeof getTranslations>>;

// Monday first, as `day.weekdayLong` lists them; `getUTCDay` is 0 for Sunday.
function weekdayOf(day: string, t: Translate): string {
  const names = t.raw("day.weekdayLong") as string[];
  return names[(civilDateToDate(day).getUTCDay() + 6) % 7];
}

// «sábado 19» without a month: a carried one-off names a day inside the last
// week, where the weekday already tells it apart.
function shortDayParts(day: string, t: Translate) {
  return { weekday: weekdayOf(day, t), day: civilDateToDate(day).getUTCDate() };
}

/**
 * Opens the app on today (RP-01): no tap, no choice, no screen before it —
 * `app/page.tsx` is the redirect gate and nothing else, this is the whole
 * screen.
 *
 * Every open goal draws as its own group, in one scroll, with no selector
 * (§0.3, 5): `loadDay`'s `commitments` names which goal each slot belongs
 * to, and `phases` — narrowed to that goal — decides the phase in effect
 * through `phaseOn`, module 4's own function, called once per goal rather
 * than reading `view.phase`, which picks a single span across every goal at
 * once and is only ever right for one of them.
 *
 * A one-off draws under the goal it belongs to (RP-19, RP-20): its own row
 * inside that goal's section, with that goal's own field to write another
 * one the same way. A one-off that belongs to nothing draws in its own
 * "Sueltas" group below the last goal, with the field that writes one of
 * those — permanently visible either way, never behind a control that
 * reveals it (`one-off-row.tsx`, `new-one-off.tsx`). A one-off undone since
 * an earlier day rides first, naming the day it was meant for.
 */
export async function DayScreen() {
  const t = await getTranslations();
  const day = todayInZone();
  const { view, evidence, goals, oneOffs, commitments, phases, factsByCommitment } =
    await loadDay(day);

  const slotByCommitmentId = new Map(view.slots.map((slot) => [slot.commitmentId, slot]));

  // Stable: within each kind, `loadDay`'s own creation order stands.
  const carriedFirst = [...oneOffs].sort(
    (a, b) => Number(!isCarried(a, day)) - Number(!isCarried(b, day)),
  );

  function oneOffRow(oneOff: OneOffSummary) {
    return (
      <OneOffRow
        key={oneOff.id}
        oneOffId={oneOff.id}
        name={oneOff.name}
        carriedFrom={
          isCarried(oneOff, day)
            ? t("day.oneOffs.carriedFrom", shortDayParts(oneOff.day, t))
            : undefined
        }
      />
    );
  }

  return (
    <Page>
      <DayHeader
        title={t("day.title")}
        toLightLabel={t("day.theme.toLight")}
        toDarkLabel={t("day.theme.toDark")}
      />

      {evidence === "unreadable" ? <EvidenceNote text={t("day.unreadableEvidence")} /> : null}

      {goals.length === 0 ? (
        <EmptyDay title={t("day.empty.title")} action={t("day.empty.action")} />
      ) : (
        <>
          {goals.map((goal) => {
            const goalPhases = phases.filter((phase) => phase.goalId === goal.id);
            const goalPhase = phaseOn(goalPhases, day);
            const rows = commitments
              .filter((commitment) => commitment.goalId === goal.id)
              .map((commitment) => ({ commitment, slot: slotByCommitmentId.get(commitment.id) }))
              // A commitment that does not ask on `day` has no slot at all
              // (`deriveDay`'s own contract) — nothing to draw for it today.
              .filter(
                (entry): entry is { commitment: CommitmentInfo; slot: DaySlot } =>
                  entry.slot !== undefined,
              );

            return (
              <section key={goal.id}>
                <SectionLabel>{goal.name}</SectionLabel>
                {goalPhase ? (
                  <Text as="p" tone="muted" variant="meta">
                    {goalPhase.name}
                  </Text>
                ) : null}
                {rows.map(({ commitment, slot }) => {
                  const logged = factsByCommitment[commitment.id];
                  return (
                    <DayRow
                      key={commitment.id}
                      commitmentId={commitment.id}
                      name={commitment.name}
                      kind={commitment.kind}
                      markState={slot.satisfiedBy === "evidence" ? "evidence" : slot.satisfied ? "declared" : "empty"}
                      sourceName={
                        slot.satisfiedBy === "evidence" && slot.labelKey ? t(slot.labelKey) : undefined
                      }
                      target={commitment.target}
                      unit={commitment.unit}
                      cadence={commitment.cadence}
                      factId={logged?.factId}
                      loggedQuantity={logged?.quantity ?? null}
                      note={logged?.note ?? null}
                    />
                  );
                })}
                {carriedFirst.filter((oneOff) => oneOff.goalId === goal.id).map(oneOffRow)}
                <NewOneOff goalId={goal.id} />
              </section>
            );
          })}
        </>
      )}

      {/* A one-off belonging to nothing (RP-20) has no goal section to draw
          under, so it gets a group of its own — always on screen, even with
          no goal open yet, because RP-19 asks for no goal behind it either. */}
      <section>
        <SectionLabel>{t("day.oneOffs.title")}</SectionLabel>
        {carriedFirst.filter((oneOff) => oneOff.goalId === null).map(oneOffRow)}
        <NewOneOff />
      </section>
    </Page>
  );
}

// A one-off meant for a day before the one drawn, still undone (RP-19):
// `loadDay` carries it with its own `day`, never clamped to today's.
function isCarried(oneOff: OneOffSummary, day: string): oneOff is OneOffSummary & { day: string } {
  return oneOff.day !== null && oneOff.day < day;
}
