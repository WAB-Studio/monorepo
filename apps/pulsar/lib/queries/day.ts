import "server-only";

import { sql } from "drizzle-orm";

import { deriveDay, type EvidenceByCommitment } from "@/lib/day/derive";
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
import { readerFor } from "@/lib/evidence/registry";
import { getPerson, withGoalsDb, withReadingDb, type Transaction } from "@/lib/session";
import { civilDateInZone, TIME_ZONE } from "@/lib/zone";

/**
 * Every source key `withReadingDb`'s query fans out to, kept beside this
 * file rather than derived from the day's own commitments: a distinct set of
 * keys can only be known once the goals query has already returned, and
 * waiting on that would turn the second transaction's opening into a
 * continuation of the first's — the very chain RNP-03 forbids. Both
 * transactions open, settle and query concurrently instead; the mapping step
 * below decides, once both have answered, which commitment each source's
 * rows belong to. A second source (RNP-10) costs a reader in
 * `lib/evidence/registry.ts`, a row in `goals.evidence_sources`, and one more
 * key here.
 *
 * This is also why `withReadingDb` runs one query *per key in this list*,
 * not one per commitment that actually needs it: today, with one key, that
 * is four statements total, the number module 8's done criterion measured.
 * **Four is a fact of today's registry, not a law of this file.** The day a
 * second key lands, a person with no commitment pointing at it still pays
 * its query — RNP-03's "bounded" still holds (bounded by the catalogue's own
 * size, which RNP-10 keeps small), but "four" stops being the count, and
 * whoever adds that key should expect the round-trip count named in a done
 * criterion to move, not stay pinned to this comment.
 */
const KNOWN_EVIDENCE_SOURCE_KEYS = ["reading_lookups"] as const;

type GoalRow = {
  id: string;
  name: string;
  horizon: string;
  measure_name: string | null;
  measure_unit: string | null;
};

// `source_key` and `source_unit` ride in from the join to `evidence_sources`;
// neither column exists on `commitments` itself (RNP-10 keeps the source a
// row of configuration, not a commitment column). `goal_id` and `name` ride
// in from `to_jsonb(c)` the same as every other bare column below — nothing
// module 4's `CommitmentPlan` reads, so `toCommitmentPlan` still ignores
// them; module 13's screen is what groups a slot by goal and names its row.
type CommitmentRow = {
  id: string;
  goal_id: string;
  name: string;
  cadence_kind: Cadence["kind"];
  cadence_n: number | null;
  cadence_weekdays: number[] | null;
  satisfaction: SatisfiedBy["kind"];
  target_quantity: number | null;
  unit: string | null;
  threshold: number | null;
  retired_at: string | null;
  created_at: string;
  source_key: string | null;
  source_unit: string | null;
};

type PhaseRow = {
  id: string;
  goal_id: string;
  aim: string;
  starts_on: string;
  ends_on: string | null;
};

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
type GoalsQueryRow = {
  goals: GoalRow[];
  commitments: CommitmentRow[];
  phases: PhaseRow[];
  facts: FactRow[];
  one_offs: OneOffRow[];
};

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
 */
async function queryGoalsRow(tx: Transaction, day: string): Promise<GoalsQueryRow> {
  const [row] = await tx.execute<GoalsQueryRow>(sql`
    select
      (select coalesce(json_agg(to_jsonb(g) order by g.created_at), '[]'::json)
         from "goals"."goals" g) as goals,
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_key', s.key,
                 'source_unit', s.unit
               ) order by c.created_at), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.retired_at is null or (c.retired_at at time zone ${TIME_ZONE})::date >= ${day}::date) as commitments,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p
         where p.starts_on <= ${day}::date
           and (p.ends_on is null or p.ends_on >= ${day}::date)) as phases,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.day = ${day}::date) as facts,
      (select coalesce(json_agg(to_jsonb(o) order by o.created_at), '[]'::json)
         from "goals"."one_offs" o
         where o.day = ${day}::date) as one_offs
  `);

  return row;
}

// One query per known source (today, exactly one), independent of which
// commitments actually reference it: the mapping step below is what narrows
// the result back down to the commitments that asked for it.
async function queryEvidenceBySource(
  tx: Transaction,
  personId: string,
  day: string,
): Promise<Record<string, EvidenceDay[]>> {
  const bySourceKey: Record<string, EvidenceDay[]> = {};

  for (const key of KNOWN_EVIDENCE_SOURCE_KEYS) {
    const reader = readerFor(key);
    if (!reader) continue;
    bySourceKey[key] = await reader({ personId, from: day, to: day, zone: TIME_ZONE, tx });
  }

  return bySourceKey;
}

function toCadence(row: CommitmentRow): Cadence {
  switch (row.cadence_kind) {
    case "daily":
      return { kind: "daily" };
    case "weekdays":
      return { kind: "weekdays", days: row.cadence_weekdays ?? [] };
    case "times_per_week":
      return { kind: "times_per_week", count: row.cadence_n ?? 0 };
    case "every_n_days":
      // `goals.commitments` has no anchor column: RP-12 (`docs/pulsar/
      // SPEC.md`) settles "every N days" to count from `created_at`, read
      // as the person's own civil day, never Postgres's UTC render of the
      // timestamp — `created_at` between 19:00 and 23:59:59 Bogotá already
      // reads as the next UTC day, so slicing that string would anchor a
      // fifth of all commitments one day late and silently shift the whole
      // cadence from the day it was actually set up.
      return {
        kind: "every_n_days",
        n: row.cadence_n ?? 1,
        anchor: civilDateInZone(new Date(row.created_at)),
      };
    case "times_per_month":
      return { kind: "times_per_month", count: row.cadence_n ?? 0 };
  }
}

function toSatisfiedBy(row: CommitmentRow): SatisfiedBy {
  switch (row.satisfaction) {
    case "tap":
      return { kind: "tap" };
    case "quantity":
      return { kind: "quantity", target: row.target_quantity ?? 0, unit: row.unit ?? "" };
    case "evidence":
      return { kind: "evidence", threshold: row.threshold ?? 1, unit: row.source_unit ?? "" };
  }
}

function toCommitmentPlan(row: CommitmentRow): CommitmentPlan {
  return {
    id: row.id,
    cadence: toCadence(row),
    satisfiedBy: toSatisfiedBy(row),
    retiredAt: row.retired_at,
  };
}

function toPhase(row: PhaseRow): Phase {
  return { id: row.id, name: row.aim, startsOn: row.starts_on, endsOn: row.ends_on };
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
  measureName: string | null;
  measureUnit: string | null;
};

function toGoalSummary(row: GoalRow): GoalSummary {
  return {
    id: row.id,
    name: row.name,
    horizon: row.horizon,
    measureName: row.measure_name,
    measureUnit: row.measure_unit,
  };
}

// A one-off already on today (RP-19, RP-20): `goalId` is null for one that
// belongs to none, and the screen draws it in its own group below the rest.
export type OneOffSummary = {
  id: string;
  goalId: string | null;
  name: string;
  day: string | null;
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

function toDeclaredFact(row: FactRow & { commitment_id: string }): DeclaredFact {
  return {
    commitmentId: row.commitment_id,
    day: row.day,
    writtenAt: row.written_at,
    quantity: row.quantity,
    unit: row.commitment_unit,
    note: row.note,
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

// Evidence arrives keyed by source, never by commitment (RNP-10: a source
// answers for the person, not for one commitment). This is the one place
// that turns it into the per-commitment map `deriveDay` expects, matching
// each evidence-satisfied commitment to the source it names.
function toEvidenceByCommitment(
  commitments: CommitmentRow[],
  bySourceKey: Record<string, EvidenceDay[]>,
): EvidenceByCommitment {
  const byCommitment: EvidenceByCommitment = {};

  for (const row of commitments) {
    if (row.satisfaction !== "evidence" || !row.source_key) continue;
    const days = bySourceKey[row.source_key];
    if (days) byCommitment[row.id] = days;
  }

  return byCommitment;
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
 */
export async function loadDay(day: string): Promise<{
  view: DayView;
  evidence: "read" | "unreadable";
  goals: GoalSummary[];
  oneOffs: OneOffSummary[];
  commitments: CommitmentInfo[];
  phases: PhaseInfo[];
  factsByCommitment: Record<string, LoggedFact>;
}> {
  const person = await getPerson();
  if (!person) throw new Error("loadDay called without a verified session");

  const [row, evidenceOutcome] = await Promise.all([
    withGoalsDb((tx) => queryGoalsRow(tx, day)),
    withReadingDb((tx) => queryEvidenceBySource(tx, person.id, day)).then(
      (bySourceKey): EvidenceOutcome => ({ status: "read", bySourceKey }),
      (): EvidenceOutcome => ({ status: "unreadable", bySourceKey: {} }),
    ),
  ]);

  const commitments = row.commitments.map(toCommitmentPlan);
  const phases = row.phases.map(toPhase);
  // A one-off's fact carries no `commitment_id`; `DeclaredFact` names one
  // that always does, so a one-off's own fact plays no part in deriving a
  // commitment's slot (RP-19's list is this file's own `oneOffs`, read by
  // module 13's screen).
  const facts = row.facts
    .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
    .map(toDeclaredFact);
  const evidence = toEvidenceByCommitment(row.commitments, evidenceOutcome.bySourceKey);

  const view = deriveDay({ commitments, phases, facts, evidence, day });

  // `completeOneOff` (module 12) never deletes the one-off's own row — it
  // only writes the fact that explains it — so a completed one-off is still
  // in `row.one_offs` and has to be read back out here: RP-19 says "done, it
  // leaves the list", and `row.facts` (unfiltered, unlike `facts` above) is
  // the one place today's completions already are, no third query needed.
  const completedOneOffIds = new Set(
    row.facts.filter((fact) => fact.one_off_id !== null).map((fact) => fact.one_off_id),
  );

  return {
    view,
    evidence: evidenceOutcome.status,
    goals: row.goals.map(toGoalSummary),
    oneOffs: row.one_offs
      .filter((oneOff) => !completedOneOffIds.has(oneOff.id))
      .map(toOneOffSummary),
    commitments: row.commitments.map(toCommitmentInfo),
    phases: row.phases.map(toPhaseInfo),
    factsByCommitment: latestFactByCommitment(row.facts.map(toFactForCommitment)),
  };
}
