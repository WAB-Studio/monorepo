import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { measureOf } from "@/lib/day/derive";
import type { Cadence, EvidenceDay, Phase, SatisfiedBy } from "@/lib/day/types";
import { knownSourceKeys, readerFor } from "@/lib/evidence/registry";
import {
  toCadence,
  toDeclaredFact,
  toPhase,
  toSatisfiedBy,
  type CommitmentRow as BaseCommitmentRow,
  type PhaseRow,
} from "@/lib/queries/rows";
import { getPerson, withGoalsDb, withReadingDb, type Transaction } from "@/lib/session";
import { TIME_ZONE } from "@/lib/zone";

// `withReadingDb`'s query fans out over `knownSourceKeys()`
// (`lib/evidence/registry.ts`), for the same reason `lib/queries/day.ts` and
// `lib/queries/week.ts` do: which source a goal's commitments actually name
// is only known once the goals query resolves, and waiting on that would
// turn this file's own `Promise.all` into the chain RNP-03 forbids.

type GoalRow = {
  id: string;
  name: string;
  horizon: string;
  measure_name: string | null;
  measure_unit: string | null;
  created_at: string;
  // Null while open, set once by `archiveGoal` (RP-24). `listGoals`'s own
  // raw select and `queryGoalRow`'s `to_jsonb(g)` both fill it, so one type
  // covers a single goal and a list of them alike.
  archived_at: string | null;
};

// `source_key`, `source_unit` and `source_label_key` ride in from the join to
// `evidence_sources`. `source_key` feeds `evidenceMeasureTotal` below, the
// same way `lib/queries/day.ts`'s own `source_key` feeds its per-commitment
// mapping; `source_label_key` widens `rows.ts`'s own `CommitmentRow` and is
// what lets the screen say which source an evidence commitment names (RP-09)
// — a catalogue key, never a sentence (RNP-01).
type CommitmentRow = BaseCommitmentRow & { source_label_key: string | null };

// `commitment_unit` rides in from the join to `commitments`: a fact carries a
// bare quantity, never its own unit.
type FactRow = {
  commitment_id: string | null;
  day: string;
  written_at: string;
  quantity: number | null;
  note: string | null;
  commitment_unit: string | null;
};

// One statement's whole shape: the goal itself (`null` when the id does not
// resolve under RLS — deleted, or somebody else's), every phase and every
// commitment it has ever had, and every fact that names it — retired
// commitments and old facts included, since a goal's screen never hides what
// it once asked for (RP-13).
type GoalQueryRow = {
  goal: GoalRow | null;
  phases: PhaseRow[];
  commitments: CommitmentRow[];
  facts: FactRow[];
};

// What a commitment reads as on the goal's own screen: its cadence and what
// satisfies it, in the engine's own shapes, plus its name and its retirement
// — drawn, never hidden (RP-13). A view of its own rather than
// `CommitmentPlan`: the goal's screen has no day to ask `asksOn` against.
export type GoalCommitment = {
  id: string;
  name: string;
  cadence: Cadence;
  satisfiedBy: SatisfiedBy;
  retiredAt: string | null;
  // The evidence source's own catalogue key (RNP-01), set only when
  // `satisfiedBy.kind === "evidence"` — the goal's screen reads the source's
  // name from `sources.json` under this key, never a sentence stored here.
  sourceLabelKey: string | null;
  // Distinct days this commitment has a declared fact on (module 18's retire
  // sheet: "los N días en que lo hiciste" — RP-13 says the days already done
  // stay done). Counted here, off `row.facts` the goal statement already
  // carries whole, never a second round trip and never a subselect: an
  // evidence-satisfied commitment writes no fact of its own (RP-05), so this
  // is 0 for one and the screen drops the clause rather than say "0 días".
  factDayCount: number;
};

export type GoalView = {
  id: string;
  name: string;
  horizon: string;
  // When the goal was opened (§0.3, 3), in the person's own zone — the goal
  // screen's own overline (RP-11), read off `to_jsonb(g)`'s whole row rather
  // than a second round trip.
  createdAt: string;
  measureName: string | null;
  measureUnit: string | null;
  // Null while open, set once the moment `archiveGoal` runs (RP-24): what
  // the goal's own screen reads to draw «Reabrir» in place of «Archivar esta
  // meta» and to drop its add-commitment / add-phase ways in.
  archivedAt: string | null;
  // A sum over facts, computed here and never read from a column (RP-14):
  // `goals.goals` has no place to hold one, and the grant layer refuses a
  // write to any column that would.
  measureTotal: number;
  phases: Phase[];
  commitments: GoalCommitment[];
  // Whether the second transaction — another app's own rows — could be read
  // this time (RNP-04). `measureTotal` above is still the goal's real total
  // when this reads `"unreadable"`: it is the declared half alone, never a
  // blank goal and never an error page.
  evidence: "read" | "unreadable";
};

export type GoalSummary = {
  id: string;
  name: string;
  horizon: string;
  measureName: string | null;
  measureUnit: string | null;
  archivedAt: string | null;
};

/**
 * One statement, four subqueries: the goal row scoped by id, and every phase,
 * commitment and fact that name it — unfiltered by `retired_at` or by day, so
 * a goal's screen reads its whole history in the one round trip. RLS alone
 * narrows every row to the caller's own (RNP-05); `goalId` alone would let a
 * caller read a goal id they merely guessed, so `goal` still comes back
 * `null` when it is not theirs.
 */
async function queryGoalRow(tx: Transaction, goalId: string): Promise<GoalQueryRow> {
  const [row] = await tx.execute<GoalQueryRow>(sql`
    select
      (select to_jsonb(g) from "goals"."goals" g where g.id = ${goalId}) as goal,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p
         where p.goal_id = ${goalId}) as phases,
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_key', s.key,
                 'source_unit', s.unit,
                 'source_label_key', s.label_key
               )), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.goal_id = ${goalId}) as commitments,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.goal_id = ${goalId}) as facts
  `);

  return row;
}

function toGoalCommitment(row: CommitmentRow, factDayCount: number): GoalCommitment {
  return {
    id: row.id,
    name: row.name,
    cadence: toCadence(row),
    satisfiedBy: toSatisfiedBy(row),
    retiredAt: row.retired_at,
    sourceLabelKey: row.satisfaction === "evidence" ? row.source_label_key : null,
    factDayCount,
  };
}

// Distinct fact days per commitment, from the goal statement's own
// unfiltered `facts` subquery — a one-off's fact carries no `commitment_id`
// and is skipped, the same guard `loadGoal` applies before `toDeclaredFact`.
function factDayCounts(facts: FactRow[]): Map<string, number> {
  const daysByCommitment = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (!fact.commitment_id) continue;
    const days = daysByCommitment.get(fact.commitment_id) ?? new Set<string>();
    days.add(fact.day);
    daysByCommitment.set(fact.commitment_id, days);
  }
  const counts = new Map<string, number>();
  for (const [commitmentId, days] of daysByCommitment) counts.set(commitmentId, days.size);
  return counts;
}

type EvidenceOutcome = {
  status: "read" | "unreadable";
  bySourceKey: Record<string, EvidenceDay[]>;
};

/**
 * The goal's own span, as two `SQL` fragments rather than two values: the
 * reading transaction opens blind, in the same `Promise.all` as the goals
 * one (RNP-03), so nothing in this process has read `created_at` or
 * `horizon` yet when this is built. Each fragment is a scalar subquery on
 * `"goals"."goals"`, fully schema-qualified so it resolves under the reading
 * connection's own `search_path` ("reading, public"), scoped to `goalId` and
 * narrowed to the caller's own row by `goals_select_self` — the very RLS
 * policy `withGoalsDb`'s own queries already lean on, applying here because
 * both transactions carry the same settled claims. `readerFor`'s own
 * contract (`lib/evidence/types.ts`) is what makes this legal without
 * teaching a source's reader anything about `goals`: `from`/`to` are typed
 * `string | SQL`, an opaque bound a reader interpolates and never inspects,
 * and `reading-lookups.ts` never spells the schema name out — only this
 * file, which already reads `goals.*` under its own door, does. Never a
 * second round trip: the subquery runs inside the reading statement itself,
 * the same one statement `queryEvidenceBySource` always sent.
 */
function goalSpan(goalId: string): { from: SQL; to: SQL } {
  return {
    // A civil day, the same conversion `civilDateInZone` applies in JS
    // elsewhere in this file, done here in SQL instead so the bound never
    // leaves the statement that needs it.
    from: sql`(select (g.created_at at time zone ${TIME_ZONE})::date
                 from "goals"."goals" g where g.id = ${goalId})`,
    // `horizon` is already a civil date (RP-11): no zone conversion needed.
    to: sql`(select g.horizon from "goals"."goals" g where g.id = ${goalId})`,
  };
}

// One query per known source (today, exactly one), independent of which of
// the goal's own commitments actually reference it — the same shape `lib/
// queries/day.ts` and `lib/queries/week.ts` run, bounded to the goal's own
// span rather than one day or one week.
async function queryEvidenceBySource(
  tx: Transaction,
  personId: string,
  goalId: string,
): Promise<Record<string, EvidenceDay[]>> {
  const bySourceKey: Record<string, EvidenceDay[]> = {};
  const { from, to } = goalSpan(goalId);

  for (const key of knownSourceKeys()) {
    const reader = readerFor(key);
    if (!reader) continue;
    bySourceKey[key] = await reader({ personId, from, to, zone: TIME_ZONE, tx });
  }

  return bySourceKey;
}

/**
 * The evidence half of `measureTotal` (RP-14, decided 2026-09-22 —
 * `docs/pulsar/SPEC.md`): a quantity in the goal's own measure unit feeds it
 * whether a fact declared it or a source recorded it, and evidence never
 * writes a fact (RP-05), so this is the only place that quantity is ever
 * summed. Only a commitment that is both evidence-satisfied and named in the
 * goal's own unit counts — the same "in that measure's unit" rule `measureOf`
 * applies to a declared fact's own unit, read here off the commitment's
 * `source_unit` instead. Deduplicated by source key, not by commitment: two
 * commitments naming the same source must not sum its rows twice. No date
 * filter here — `goalSpan` already bounded what `bySourceKey` can hold to
 * the goal's own span, in SQL, before these rows ever reached this process.
 */
function evidenceMeasureTotal(
  goal: GoalRow,
  commitments: CommitmentRow[],
  bySourceKey: Record<string, EvidenceDay[]>,
): number {
  if (!goal.measure_unit) return 0;

  const matchingKeys = new Set(
    commitments
      .filter(
        (row) =>
          row.satisfaction === "evidence" &&
          row.source_key !== null &&
          row.source_unit === goal.measure_unit,
      )
      .map((row) => row.source_key as string),
  );

  let total = 0;
  for (const key of matchingKeys) {
    for (const day of bySourceKey[key] ?? []) total += day.quantity;
  }
  return total;
}

/**
 * Feeds the goal's own screen in exactly two transactions, fanned with
 * `Promise.all` and never chained (RNP-03) — the same shape `lib/queries/
 * day.ts`'s `loadDay` and `lib/queries/week.ts`'s `loadWeek` already run, over
 * the goal's own span rather than a day or a week. The evidence promise is
 * settled here, not awaited bare: a rejection degrades to `"unreadable"` and
 * `measureTotal` still carries the declared half alone (RNP-04) — a goal
 * screen never fails because another app's rows could not be read.
 */
export async function loadGoal(goalId: string): Promise<GoalView> {
  const person = await getPerson();
  if (!person) throw new Error("loadGoal called without a verified session");

  const [row, evidenceOutcome] = await Promise.all([
    withGoalsDb((tx) => queryGoalRow(tx, goalId)),
    withReadingDb((tx) => queryEvidenceBySource(tx, person.id, goalId)).then(
      (bySourceKey): EvidenceOutcome => ({ status: "read", bySourceKey }),
      (): EvidenceOutcome => ({ status: "unreadable", bySourceKey: {} }),
    ),
  ]);

  if (!row.goal) throw new Error("loadGoal called with an unknown goal");

  const phases = row.phases.map(toPhase);
  const dayCounts = factDayCounts(row.facts);
  const commitments = row.commitments.map((commitment) =>
    toGoalCommitment(commitment, dayCounts.get(commitment.id) ?? 0),
  );
  // A one-off's fact carries no `commitment_id`, and no unit to feed the
  // measure with; only a commitment's own quantity ever can (RP-14).
  const facts = row.facts
    .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
    .map(toDeclaredFact);

  // Null until the first quantity commitment names it (§0.3, 3): nothing to
  // sum into yet, so the total stays zero rather than matching facts with no
  // unit of their own against a measure the goal does not have.
  const declaredTotal = row.goal.measure_unit ? measureOf(row.goal.measure_unit, facts) : 0;
  const evidenceTotal =
    evidenceOutcome.status === "read"
      ? evidenceMeasureTotal(row.goal, row.commitments, evidenceOutcome.bySourceKey)
      : 0;

  return {
    id: row.goal.id,
    name: row.goal.name,
    horizon: row.goal.horizon,
    createdAt: row.goal.created_at,
    measureName: row.goal.measure_name,
    measureUnit: row.goal.measure_unit,
    archivedAt: row.goal.archived_at,
    measureTotal: declaredTotal + evidenceTotal,
    phases,
    commitments,
    evidence: evidenceOutcome.status,
  };
}

function toGoalSummary(row: GoalRow): GoalSummary {
  return {
    id: row.id,
    name: row.name,
    horizon: row.horizon,
    measureName: row.measure_name,
    measureUnit: row.measure_unit,
    archivedAt: row.archived_at,
  };
}

/**
 * One transaction, one statement: every *open* goal the person has, for
 * `app/(app)/metas/[goalId]/compromisos/nuevo/page.tsx`'s own lookup — an
 * archived goal excluded (RP-24) is what makes a direct visit to that route
 * 404 for one, the same way "no add-commitment button" reads on its own
 * screen. `listGoalsForMetas` below is `/metas`'s own query: it needs the
 * archived half too, to list under "Archivadas".
 */
export async function listGoals(): Promise<GoalSummary[]> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<GoalRow>(sql`
      select id, name, horizon, measure_name, measure_unit, archived_at
      from "goals"."goals"
      where archived_at is null
      order by created_at
    `),
  );

  return rows.map(toGoalSummary);
}

/**
 * `/metas`'s own query (RP-24): one statement, every goal the person has
 * ever opened, split into "open" and "archived" here rather than by a
 * second round trip — the screen lists the first, then a quiet "Archivadas"
 * section for the second, each still its own way into `Meta.dc.html`.
 */
export async function listGoalsForMetas(): Promise<{ open: GoalSummary[]; archived: GoalSummary[] }> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<GoalRow>(sql`
      select id, name, horizon, measure_name, measure_unit, archived_at
      from "goals"."goals"
      order by created_at
    `),
  );

  const summaries = rows.map(toGoalSummary);
  return {
    open: summaries.filter((goal) => goal.archivedAt === null),
    archived: summaries.filter((goal) => goal.archivedAt !== null),
  };
}
