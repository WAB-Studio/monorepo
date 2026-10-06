import "server-only";

import { sql } from "drizzle-orm";

import { phaseOn } from "@/lib/day/derive";
import type { EvidenceDay } from "@/lib/day/types";
import { dayBefore } from "@/lib/day/weeks";
import { knownSourceKeys, readerFor } from "@/lib/evidence/registry";
import type { GoalReport, Report, ReportTask } from "@/lib/export/report";
import { carryShare, monthList, type MonthItem } from "@/lib/plan/carry";
import { monthOf, toDate } from "@/lib/plan/months";
import {
  goalFigures,
  type CommitmentRow,
  type FactRow,
  type GoalRow,
  type TaskRow,
} from "@/lib/queries/goal";
import { toPhase, type PhaseRow } from "@/lib/queries/rows";
import { getPerson, withGoalsDb, withReadingDb, type Transaction } from "@/lib/session";
import { civilDateInZone, TIME_ZONE, todayInZone } from "@/lib/zone";

// One row per open goal, each carrying what `queryGoalRow` (`goal.ts`) reads
// for a single one.
type ReportRow = {
  goal: GoalRow;
  phases: PhaseRow[];
  commitments: CommitmentRow[];
  facts: FactRow[];
  budgets: { month: string; amount: number }[];
  tasks: TaskRow[];
};

// One statement over every goal not archived (RP-33). RLS narrows it to the
// caller's own rows (RNP-05).
async function queryReportRows(tx: Transaction): Promise<ReportRow[]> {
  const rows = await tx.execute<ReportRow>(sql`
    select
      to_jsonb(g) as goal,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p where p.goal_id = g.id) as phases,
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_key', s.key,
                 'source_unit', s.unit,
                 'source_label_key', s.label_key
               )), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.goal_id = g.id) as commitments,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.goal_id = g.id) as facts,
      (select coalesce(json_agg(jsonb_build_object('month', b.month, 'amount', b.amount)
                                order by b.month), '[]'::json)
         from "goals"."month_budgets" b where b.goal_id = g.id) as budgets,
      (select coalesce(json_agg(to_jsonb(o) || jsonb_build_object(
                 'done_on', (select min(f.day) from "goals"."facts" f where f.one_off_id = o.id)
               ) order by o.position, o.created_at, o.id), '[]'::json)
         from "goals"."one_offs" o where o.goal_id = g.id) as tasks
    from "goals"."goals" g
    where g.archived_at is null
    order by g.position, g.created_at, g.id
  `);
  return [...rows];
}

// Bounded in SQL from the earliest open goal's opening, as `goalSpan` does
// for one goal: the reading statement opens blind, beside the goals one.
async function queryReportEvidence(
  tx: Transaction,
  personId: string,
  today: string,
): Promise<Record<string, EvidenceDay[]>> {
  const bySourceKey: Record<string, EvidenceDay[]> = {};
  const from = sql`(select min((g.created_at at time zone ${TIME_ZONE})::date)
                      from "goals"."goals" g where g.archived_at is null)`;

  for (const key of knownSourceKeys()) {
    const reader = readerFor(key);
    if (!reader) continue;
    bySourceKey[key] = await reader({ personId, from, to: today, zone: TIME_ZONE, tx });
  }

  return bySourceKey;
}

// What `monthList` hands «Mes», done and not (RP-46). A parent is done on its
// last child's day; `owes` counts what is undone today.
function toReportTask(item: MonthItem): ReportTask {
  const leaf = item.children.length === 0;
  const undone = item.children.filter((child) => child.doneOn === null);
  const doneOn = !item.done
    ? null
    : leaf
      ? item.task.doneOn
      : item.children.reduce<string | null>(
          (last, child) => (last === null || (child.doneOn ?? "") > last ? child.doneOn : last),
          null,
        );
  return {
    name: item.task.name,
    from: item.carriedFrom,
    done: item.done,
    doneOn,
    estimate: leaf ? item.task.estimate : null,
    owes: leaf
      ? item.task.doneOn === null
        ? (item.task.estimate ?? 0)
        : 0
      : undone.reduce((sum, child) => sum + (child.estimate ?? 0), 0),
    hasAmount: item.hasAmount,
    note: item.task.note ?? null,
    children: item.children.map((child) => ({
      name: child.name,
      done: child.doneOn !== null,
      doneOn: child.doneOn,
      estimate: child.estimate,
      note: child.note ?? null,
    })),
  };
}

// The days `loadGoal` would have read: its own opening to its horizon.
function withinGoal(
  bySourceKey: Record<string, EvidenceDay[]>,
  openedOn: string,
  horizon: string,
): Record<string, EvidenceDay[]> {
  const bounded: Record<string, EvidenceDay[]> = {};
  for (const [key, days] of Object.entries(bySourceKey)) {
    bounded[key] = days.filter((day) => day.day >= openedOn && day.day <= horizon);
  }
  return bounded;
}

/**
 * The export's data (RP-33): every goal not archived, in two transactions
 * fanned with `Promise.all` — one over the goals, one over the evidence — so
 * the goal count never lengthens the chain (RNP-03). An evidence rejection
 * degrades to `"unreadable"` and every goal keeps its declared half (RNP-04).
 */
export async function loadReport(today: string = todayInZone()): Promise<Report> {
  const person = await getPerson();
  if (!person) throw new Error("loadReport called without a verified session");

  const [rows, evidenceOutcome] = await Promise.all([
    withGoalsDb(queryReportRows),
    withReadingDb((tx) => queryReportEvidence(tx, person.id, today)).then(
      (bySourceKey) => ({ status: "read" as const, bySourceKey }),
      () => ({ status: "unreadable" as const, bySourceKey: {} }),
    ),
  ]);

  const thisMonth = monthOf(today);
  const goals = rows.map((row): GoalReport => {
    const phases = row.phases.map(toPhase);
    const openedOn = civilDateInZone(new Date(row.goal.created_at));
    const figures = goalFigures({
      goal: row.goal,
      phases,
      commitments: row.commitments,
      facts: row.facts,
      budgets: row.budgets,
      tasks: row.tasks,
      evidence:
        evidenceOutcome.status === "read"
          ? withinGoal(evidenceOutcome.bySourceKey, openedOn, row.goal.horizon)
          : null,
      today,
    });
    const current = phaseOn(phases, today);

    return {
      id: row.goal.id,
      name: row.goal.name,
      horizon: row.goal.horizon,
      endedOn: row.goal.horizon <= today ? dayBefore(row.goal.horizon) : null,
      unit: row.goal.measure_unit,
      thisMonth: {
        planned: figures.month?.planned ?? null,
        reached: figures.month?.reached ?? 0,
        underPace: figures.month?.underPace ?? false,
      },
      toDate: toDate(figures.months),
      phases: phases.map((phase) => ({
        aim: phase.name,
        startsOn: phase.startsOn,
        endsOn: phase.endsOn ?? dayBefore(row.goal.horizon),
        current: current?.id === phase.id,
      })),
      tasks: monthList(figures.tasks, thisMonth, today).map(toReportTask),
      carried: monthList(figures.tasks, thisMonth, today)
        .filter((item) => item.carriedFrom !== null && !item.done)
        .map((item) => {
          // Only what is undone today: a child done this month owes nothing.
          const children = item.children
            .filter((child) => child.doneOn === null)
            .map((child) => ({
              name: child.name,
              note: child.note ?? null,
              owes: child.estimate ?? 0,
              hasAmount: child.estimate !== null,
            }));
          const leaf = item.children.length === 0;
          return {
            name: item.task.name,
            note: item.task.note ?? null,
            from: item.carriedFrom as string,
            owes: leaf ? (item.task.estimate ?? 0) : children.reduce((sum, c) => sum + c.owes, 0),
            hasAmount: leaf ? item.task.estimate !== null : children.some((c) => c.hasAmount),
            children,
          };
        }),
      months: figures.months.map((row) => {
        const share = row.past ? carryShare(figures.tasks, row.month) : null;
        return {
          ...row,
          carried: share ? Math.floor((share.carried * 100) / share.planned) : null,
        };
      }),
      weeks: figures.weeks,
    };
  });

  return { today, evidence: evidenceOutcome.status === "read" ? "read" : "unreadable", goals };
}
