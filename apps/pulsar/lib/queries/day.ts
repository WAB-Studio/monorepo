import "server-only";

import { sql } from "drizzle-orm";

import { deriveDay } from "@/lib/day/derive";
import { evidenceDaysFor } from "@/lib/day/measure-inputs";
import { measureByWeek } from "@/lib/day/review";
import { latestFactByCommitment, type LoggedFact } from "@/lib/day/logged-fact";
import type {
  Cadence,
  CommitmentPlan,
  DayView,
  DeclaredFact,
  EvidenceDay,
  Phase,
  SatisfiedBy,
} from "@/lib/day/types";
import { phasePositions } from "@/lib/day/row-phrases";
import { knownSourceKeys, readerFor } from "@/lib/evidence/registry";
import {
  toCadence,
  toDeclaredFact,
  toEvidenceByCommitment,
  toPhase,
  toSatisfiedBy,
  type CommitmentRow as BaseCommitmentRow,
  type PhaseRow as BasePhaseRow,
} from "@/lib/queries/rows";
import { getPerson, withGoalsDb, withReadingDb, type Transaction } from "@/lib/session";
import { civilDateInZone, civilDateToDate, dateToCivilDate, TIME_ZONE, weekOf } from "@/lib/zone";

// `withReadingDb`'s query fans out over `knownSourceKeys()`
// (`lib/evidence/registry.ts`), never over the day's own commitments: a
// distinct set of keys can only be known once the goals query has already
// returned, and waiting on that would turn the second transaction's opening
// into a continuation of the first's — the very chain RNP-03 forbids. Both
// transactions open, settle and query concurrently instead; the mapping step
// below decides, once both have answered, which commitment each source's
// rows belong to.
//
// This is also why `withReadingDb` runs one query *per known key*, not one
// per commitment that actually needs it: today, with one key, that is four
// statements total, the number module 8's done criterion measured. **Four is
// a fact of today's registry, not a law of this file.** The day a second key
// lands, a person with no commitment pointing at it still pays its query —
// RNP-03's "bounded" still holds (bounded by the catalogue's own size, which
// RNP-10 keeps small), but "four" stops being the count.

type GoalRow = {
  id: string;
  name: string;
  horizon: string;
  created_at: string;
  measure_name: string | null;
  measure_unit: string | null;
};

// `source_key` and `source_unit` ride in from the join to `evidence_sources`;
// neither column exists on `commitments` itself (RNP-10 keeps the source a
// row of configuration, not a commitment column). `goal_id` widens
// `rows.ts`'s own `CommitmentRow` — nothing module 4's `CommitmentPlan`
// reads, so `toCommitmentPlan` still ignores it; module 13's screen is what
// groups a slot by goal and names its row.
type CommitmentRow = BaseCommitmentRow & { goal_id: string };

type PhaseRow = BasePhaseRow & { goal_id: string };

// `commitment_unit` rides in from the join to `commitments`: a fact carries a
// bare quantity, never its own unit (`db/schema/commitments.ts`'s own
// comment — "the unit belongs here, never to the fact that repeats it").
// `id` rides in from `to_jsonb(f)` like every other bare column here — it was
// read out from the start, only never named on this type before module 34
// needed a row's own fact to undo (RP-05).
type FactRow = {
  id: string;
  commitment_id: string | null;
  one_off_id: string | null;
  goal_id: string | null;
  day: string;
  written_at: string;
  quantity: number | null;
  note: string | null;
  commitment_unit: string | null;
};

type OneOffRow = {
  id: string;
  goal_id: string | null;
  name: string;
  day: string | null;
};

// The one statement's whole shape. `goals` and `one_offs` are fetched here
// and, beside `view`, returned from `loadDay` below as `GoalSummary[]` and
// `OneOffSummary[]` — `deriveDay` takes no goals array and `DayView` has no
// place for a one-off, so module 13's screen is what groups a slot under the
// goal it belongs to and draws a one-off beneath the last one.
type DoneOneOffRow = {
  id: string;
  goal_id: string | null;
  name: string;
  fact_id: string;
  written_at: string;
};

// Every evidence commitment of a goal, retired ones included: the source keys
// a goal's measure reads, as `loadGoal` reads them.
type MeasureSourceRow = {
  goal_id: string;
  satisfaction: string;
  source_key: string | null;
  source_unit: string | null;
};

type GoalsQueryRow = {
  goals: GoalRow[];
  commitments: CommitmentRow[];
  phases: PhaseRow[];
  facts: FactRow[];
  one_offs: OneOffRow[];
  done_one_offs: DoneOneOffRow[];
  dayless_count: number;
  measure_sources: MeasureSourceRow[];
  scheduled_count: number;
  last_ended: { name: string; horizon: string } | null;
  ended_this_week: { id: string; name: string; horizon: string }[];
};

// A goal is open on `day` while its horizon, the first day after it, lies
// after `day`. The one rule every subquery below that asks "open" reuses.
function openGoal(alias: string, day: string) {
  return sql`${sql.raw(alias)}.archived_at is null and ${sql.raw(alias)}.horizon > ${day}::date`;
}

export type EndedGoal = { id: string; name: string; lastDay: string };

// A horizon is the first day after the goal; its last day is the one before.
function dayBefore(day: string): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateToCivilDate(date);
}

type EvidenceOutcome = {
  status: "read" | "unreadable";
  bySourceKey: Record<string, EvidenceDay[]>;
};

/**
 * One statement, five subqueries: everything the day's derivation needs,
 * scoped to the caller's own rows by RLS alone — no `user_id` filter is
 * written here, the same choice `lib/evidence/reading-lookups.ts` took, so
 * the policy is the reason the rows are safe, not a second copy of it.
 *
 * `retired_at` is `timestamptz`: read as `::date` bare it renders in the
 * session's own zone (UTC here), so a commitment retired after 19:00 Bogotá
 * would still ask for one more day. `at time zone ${TIME_ZONE}` first turns
 * it into the person's own civil day before the cast, the same move
 * `lib/queries/goal.ts`'s `goalSpan` already makes on `created_at`.
 *
 * `goals` is the one subquery RP-24 filters: an archived goal is never in
 * this list, and `DayScreen` (module 13) only ever groups a row under a goal
 * it finds here — a commitment or a one-off belonging to an archived goal
 * still rides along unfiltered in its own subquery below, but nothing loops
 * over either outside the per-goal grouping, so it never draws. `goals.length
 * === 0` is also what decides the day's own empty state (`empty-day.tsx`), so
 * an all-archived person needs no second check.
 */
async function queryGoalsRow(
  tx: Transaction,
  day: string,
  weekStart: string,
): Promise<GoalsQueryRow> {
  const [row] = await tx.execute<GoalsQueryRow>(sql`
    select
      (select coalesce(json_agg(to_jsonb(g) order by g.created_at), '[]'::json)
         from "goals"."goals" g
         where g.archived_at is null and g.horizon > ${weekStart}::date) as goals,
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_key', s.key,
                 'source_unit', s.unit
               ) order by c.created_at), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.retired_at is null or (c.retired_at at time zone ${TIME_ZONE})::date >= ${day}::date) as commitments,
      (select coalesce(json_agg(jsonb_build_object(
                 'goal_id', c.goal_id,
                 'satisfaction', c.satisfaction,
                 'source_key', s.key,
                 'source_unit', s.unit
               )), '[]'::json)
         from "goals"."commitments" c
         join "goals"."evidence_sources" s on s.id = c.source_id
         where c.satisfaction = 'evidence') as measure_sources,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p) as phases,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.day between ${weekStart}::date and ${day}::date) as facts,
      (select coalesce(json_agg(to_jsonb(o) order by o.created_at), '[]'::json)
         from "goals"."one_offs" o
         where o.day <= ${day}::date
           and not exists (
             select 1 from "goals"."facts" f where f.one_off_id = o.id
           )) as one_offs,
      (select coalesce(json_agg(jsonb_build_object(
                 'id', o.id,
                 'goal_id', o.goal_id,
                 'name', o.name,
                 'fact_id', f.id,
                 'written_at', f.written_at
               ) order by f.written_at), '[]'::json)
         from "goals"."one_offs" o
         join "goals"."facts" f on f.one_off_id = o.id
         where f.day = ${day}::date) as done_one_offs,
      (select count(*)::int
         from "goals"."one_offs" o
         where o.day is null
           and not exists (
             select 1 from "goals"."facts" f where f.one_off_id = o.id
           )
           and (o.goal_id is null or exists (
             select 1 from "goals"."goals" g
             where g.id = o.goal_id and ${openGoal("g", day)}
           ))) as dayless_count,
      (select count(*)::int
         from "goals"."one_offs" o
         where o.day > ${day}::date
           and not exists (
             select 1 from "goals"."facts" f where f.one_off_id = o.id
           )
           and (o.goal_id is null or exists (
             select 1 from "goals"."goals" g
             where g.id = o.goal_id and ${openGoal("g", day)}
           ))) as scheduled_count,
      (select jsonb_build_object('name', g.name, 'horizon', g.horizon)
         from "goals"."goals" g
         where g.archived_at is null and g.horizon <= ${day}::date
         order by g.horizon desc
         limit 1) as last_ended,
      (select coalesce(json_agg(jsonb_build_object(
                 'id', g.id,
                 'name', g.name,
                 'horizon', g.horizon
               ) order by g.horizon desc, g.created_at), '[]'::json)
         from "goals"."goals" g
         where g.archived_at is null
           and g.horizon > ${weekStart}::date
           and g.horizon <= ${day}::date) as ended_this_week
  `);

  return row;
}

// One query per known source (today, exactly one), independent of which
// commitments actually reference it: the mapping step below is what narrows
// the result back down to the commitments that asked for it.
async function queryEvidenceBySource(
  tx: Transaction,
  personId: string,
  from: string,
  day: string,
): Promise<Record<string, EvidenceDay[]>> {
  const bySourceKey: Record<string, EvidenceDay[]> = {};

  for (const key of knownSourceKeys()) {
    const reader = readerFor(key);
    if (!reader) continue;
    bySourceKey[key] = await reader({ personId, from, to: day, zone: TIME_ZONE, tx });
  }

  return bySourceKey;
}

function toCommitmentPlan(row: CommitmentRow): CommitmentPlan {
  return {
    id: row.id,
    cadence: toCadence(row),
    satisfiedBy: toSatisfiedBy(row),
    retiredAt: row.retired_at,
    createdOn: civilDateInZone(new Date(row.created_at)),
  };
}

// `Phase` (module 4) names no goal: `deriveDay`'s own `phaseOn` picks the
// first span that holds `day` out of every phase across every goal, which is
// only ever right for one goal at a time. Module 13's screen calls that same
// `phaseOn` itself, once per goal, against phases narrowed to that goal by
// this `goalId` — `deriveDay` and `DayView.phase` stay exactly as module 4
// left them.
export type PhaseInfo = Phase & { goalId: string };

function toPhaseInfo(row: PhaseRow): PhaseInfo {
  return { ...toPhase(row), goalId: row.goal_id };
}

// A goal's own name and measure (RP-11, RP-14), read beside `DayView` rather
// than folded into it: the day engine derives a slot, never a group.
export type GoalSummary = {
  id: string;
  name: string;
  horizon: string;
  // The civil day the goal was written, in the person's zone.
  openedOn: string;
  measureName: string | null;
  measureUnit: string | null;
};

function toGoalSummary(row: GoalRow): GoalSummary {
  return {
    id: row.id,
    name: row.name,
    horizon: row.horizon,
    openedOn: civilDateInZone(new Date(row.created_at)),
    measureName: row.measure_name,
    measureUnit: row.measure_unit,
  };
}

// A one-off still owed (RP-19, RP-20): `goalId` is null for one that belongs
// to none, and the screen draws it in its own group below the rest. `day` is
// the one-off's own, not the day drawn — a screen reading `day < view.day`
// is reading a carried one-off, undone since a day before today's; RP-19
// widened 2026-09-28 says it rides every day after its own until it is done
// or deleted, never just the one it was written for.
export type OneOffSummary = {
  id: string;
  goalId: string | null;
  name: string;
  day: string | null;
};

// A one-off whose fact lands on the day drawn: RP-19's "done stays", read
// back with the fact's id so the screen can undo it.
export type DoneOneOffSummary = {
  id: string;
  goalId: string | null;
  name: string;
  factId: string;
  // The instant the fact was written; the screen prints its time of day.
  writtenAt: string;
};

function toOneOffSummary(row: OneOffRow): OneOffSummary {
  return { id: row.id, goalId: row.goal_id, name: row.name, day: row.day };
}

// What a `DaySlot` (`lib/day/types.ts`) does not carry: which goal a
// commitment belongs to, its own name, and the mechanism that satisfies it —
// module 13's screen groups by the first, names a row with the second, and
// decides a tap's target with the third (a `quantity` row opens the
// quantity sheet instead of calling `declareFact` bare). `target` and `unit`
// ride the same `commitments` row `toSatisfiedBy` already reads (RP-03); null
// for every kind but `quantity`, which is the only one that needs them.
// `cadence` is `toCadence`'s own return (used above to build `CommitmentPlan`
// for `deriveDay`), read a second time here for the row's own second line —
// no new column, no second query: `to_jsonb(c)` already carries every column
// `toCadence` reads.
export type CommitmentInfo = {
  id: string;
  goalId: string;
  name: string;
  kind: SatisfiedBy["kind"];
  target: number | null;
  unit: string | null;
  cadence: Cadence;
};

function toCommitmentInfo(row: CommitmentRow): CommitmentInfo {
  return {
    id: row.id,
    goalId: row.goal_id,
    name: row.name,
    kind: row.satisfaction,
    target: row.satisfaction === "quantity" ? row.target_quantity : null,
    unit: row.satisfaction === "quantity" ? row.unit : null,
    cadence: toCadence(row),
  };
}

// `LoggedFact` and the rule that picks it — the latest write, never the
// first row — live in `lib/day/logged-fact.ts`, pure and DB-free so a plain
// `node:test` can pin that rule with no database behind it.
function toFactForCommitment(row: FactRow) {
  return {
    id: row.id,
    commitmentId: row.commitment_id,
    writtenAt: row.written_at,
    quantity: row.quantity,
    note: row.note,
  };
}

// The goal's measure from the Monday of `day` to `day`: the current row of
// the same `measureByWeek` `loadGoal`'s `weeks` runs, over the week's facts
// of the goal's own commitments and the evidence in its unit, deduped by
// source key the way `lib/queries/goal.ts` does. A goal with no measure has
// no key.
function weekMeasureOf(
  goals: GoalRow[],
  row: GoalsQueryRow,
  evidenceOutcome: EvidenceOutcome,
  day: string,
): Record<string, number> {
  const measure: Record<string, number> = {};
  for (const goal of goals) {
    const unit = goal.measure_unit;
    if (!unit) continue;
    // By the fact's own `goal_id`, as `loadGoal` does: a commitment retired
    // earlier this week still counts what it declared.
    const facts: DeclaredFact[] = row.facts
      .filter(
        (fact): fact is FactRow & { commitment_id: string } =>
          fact.goal_id === goal.id && fact.commitment_id !== null,
      )
      .map(toDeclaredFact);
    const evidence = evidenceDaysFor(
      unit,
      row.measure_sources.filter((source) => source.goal_id === goal.id),
      evidenceOutcome.bySourceKey,
    );
    const current = measureByWeek({
      openedOn: civilDateInZone(new Date(goal.created_at)),
      horizon: goal.horizon,
      today: day,
      unit,
      facts,
      evidence,
      phases: [],
    }).find((week) => week.current);
    measure[goal.id] = current?.total ?? 0;
  }
  return measure;
}

/**
 * Feeds the day screen in exactly two transactions, fanned with `Promise
 * .all` and never chained (RNP-03): `withGoalsDb`'s one statement is
 * everything the day derives from, `withReadingDb`'s is every known
 * source's rows for `[day, day]`. The evidence promise is settled here, not
 * awaited bare — a rejection degrades to `"unreadable"` and the declared
 * facts alone decide the day (RNP-04): never a blank day, never an error
 * page.
 *
 * `goals`, `oneOffs` and `commitments` ride out of the same `withGoalsDb`
 * statement `view` is derived from — no third query, still four statements
 * total (`withGoalsDb`'s settle + select, `withReadingDb`'s settle + select).
 * Module 13's screen is what groups a slot under its goal and draws a
 * one-off beneath the last one; `DayView` and `deriveDay` (module 4) are
 * unchanged.
 *
 * `oneOffs` carries every one-off dated on or before `day` that no fact yet
 * names, whatever day that fact was written on (RP-19 widened 2026-09-28):
 * an undone one-off from three days back rides every `loadDay` after its
 * own until it is done or deleted, read here through `o.day <= day` beside
 * the row-level `not exists` the SQL above already runs. `OneOffSummary`
 * still carries its own `day`, unclamped, so a caller can tell a carried one
 * from today's own by comparing it against the day drawn.
 */
export async function loadDay(day: string): Promise<{
  view: DayView;
  evidence: "read" | "unreadable";
  goals: GoalSummary[];
  oneOffs: OneOffSummary[];
  doneOneOffs: DoneOneOffSummary[];
  daylessCount: number;
  scheduledCount: number;
  // The open-less day's own words: the goal whose end came last (name, horizon).
  lastEnded: { name: string; horizon: string } | null;
  // Goals whose last day fell in the Monday-to-Sunday week of `day`, before
  // `day` itself, most recent first: what Hoy's «terminó ayer» line names.
  endedThisWeek: EndedGoal[];
  weekMeasure: Record<string, number>;
  commitments: CommitmentInfo[];
  phases: PhaseInfo[];
  // Each phase's place among its goal's phases, in every phase the goal has.
  phasePositions: Record<string, { ordinal: number; total: number }>;
  factsByCommitment: Record<string, LoggedFact>;
}> {
  const person = await getPerson();
  if (!person) throw new Error("loadDay called without a verified session");

  const weekStart = weekOf(day)[0];

  const [row, evidenceOutcome] = await Promise.all([
    withGoalsDb((tx) => queryGoalsRow(tx, day, weekStart)),
    withReadingDb((tx) => queryEvidenceBySource(tx, person.id, weekStart, day)).then(
      (bySourceKey): EvidenceOutcome => ({ status: "read", bySourceKey }),
      (): EvidenceOutcome => ({ status: "unreadable", bySourceKey: {} }),
    ),
  ]);

  const commitments = row.commitments.map(toCommitmentPlan);
  // The statement returns every phase so a goal's phase can say its place
  // among them; what the day derives from stays the ones in effect on `day`.
  const inEffect = row.phases.filter(
    (phase) => phase.starts_on <= day && (phase.ends_on === null || phase.ends_on >= day),
  );
  const phases = inEffect.map(toPhase);
  // A one-off's fact carries no `commitment_id`; `DeclaredFact` names one
  // that always does, so a one-off's own fact plays no part in deriving a
  // commitment's slot (RP-19's list is this file's own `oneOffs`, read by
  // module 13's screen).
  const dayFacts = row.facts.filter((fact) => fact.day === day);
  const facts = dayFacts
    .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
    .map(toDeclaredFact);
  const dayEvidence = Object.fromEntries(
    Object.entries(evidenceOutcome.bySourceKey).map(([key, days]) => [
      key,
      days.filter((d) => d.day === day),
    ]),
  );
  const evidence = toEvidenceByCommitment(row.commitments, dayEvidence);
  const goals = row.goals.filter((goal) => goal.horizon > day);

  const view = deriveDay({ commitments, phases, facts, evidence, day });

  // `completeOneOff` (module 12) never deletes the one-off's own row — it
  // only writes the fact that explains it — so the `one_offs` subquery
  // itself carries the `not exists (... facts ...)` check now (RP-19's
  // "done, it leaves the list", true on any day the fact was written, not
  // only today's): `row.one_offs` already excludes a completed one, no JS
  // filter and no third query needed.
  return {
    view,
    evidence: evidenceOutcome.status,
    goals: goals.map(toGoalSummary),
    oneOffs: row.one_offs.map(toOneOffSummary),
    doneOneOffs: row.done_one_offs.map((o) => ({
      id: o.id,
      goalId: o.goal_id,
      name: o.name,
      factId: o.fact_id,
      writtenAt: o.written_at,
    })),
    daylessCount: row.dayless_count,
    scheduledCount: row.scheduled_count,
    lastEnded: row.last_ended,
    endedThisWeek: row.ended_this_week.map((goal) => ({
      id: goal.id,
      name: goal.name,
      lastDay: dayBefore(goal.horizon),
    })),
    weekMeasure: weekMeasureOf(goals, row, evidenceOutcome, day),
    commitments: row.commitments.map(toCommitmentInfo),
    phases: inEffect.map(toPhaseInfo),
    phasePositions: phasePositions(row.phases.map((phase) => ({ id: phase.id, goalId: phase.goal_id, startsOn: phase.starts_on }))),
    factsByCommitment: latestFactByCommitment(dayFacts.map(toFactForCommitment)),
  };
}
