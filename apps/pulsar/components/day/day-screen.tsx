import { getTranslations } from "next-intl/server";

import { Mark, Page, Row, SectionLabel, Text } from "@/components/ui";
import { phaseOn } from "@/lib/day/derive";
import type { DaySlot } from "@/lib/day/types";
import { loadDay, type CommitmentInfo } from "@/lib/queries/day";
import { todayInZone } from "@/lib/zone";

import { DayHeader } from "./day-header";
import { DayRow } from "./day-row";
import { EmptyDay } from "./empty-day";
import { EvidenceNote } from "./evidence-note";

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
 * Today's one-offs draw in their own group below the last goal (RP-19,
 * RP-20), as a plain row rather than an interactive one: tapping one to
 * complete it and the field that writes a new one are module 15's own
 * files (`one-off-row.tsx`, `new-one-off.tsx`), not built in this module.
 */
export async function DayScreen() {
  const t = await getTranslations();
  const day = todayInZone();
  const { view, evidence, goals, oneOffs, commitments, phases } = await loadDay(day);

  const slotByCommitmentId = new Map(view.slots.map((slot) => [slot.commitmentId, slot]));

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
                {rows.map(({ commitment, slot }) => (
                  <DayRow
                    key={commitment.id}
                    commitmentId={commitment.id}
                    name={commitment.name}
                    kind={commitment.kind}
                    markState={slot.satisfiedBy === "evidence" ? "evidence" : slot.satisfied ? "declared" : "empty"}
                    sourceName={
                      slot.satisfiedBy === "evidence" && slot.labelKey ? t(slot.labelKey) : undefined
                    }
                  />
                ))}
              </section>
            );
          })}

          {oneOffs.length > 0 ? (
            <section>
              <SectionLabel>{t("day.oneOffs.title")}</SectionLabel>
              {oneOffs.map((oneOff) => (
                <Row
                  key={oneOff.id}
                  leading={<Mark state="empty" />}
                  name={oneOff.name}
                  disabled
                />
              ))}
            </section>
          ) : null}
        </>
      )}
    </Page>
  );
}
