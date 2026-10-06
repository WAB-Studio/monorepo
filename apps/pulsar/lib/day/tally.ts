import { civilDateInZone } from "@/lib/zone";
import type { Cadence, DayView, WeekView } from "@/lib/day/types";

// What `tallyDays` reads of `loadWeek`'s answer, spelled structurally so this
// file stays pure and DB-free.
type TallyInput = {
  view: WeekView;
  goals: { id: string; horizon: string; createdAt: string }[];
  commitments: { id: string; goalId: string; cadence?: Cadence }[];
  oneOffFacts: { day: string; goalId: string | null }[];
};

export function isFlexible(cadence: Cadence): boolean {
  return cadence.kind === "times_per_week" || cadence.kind === "times_per_month";
}

export type DayTally = { day: string; done: number; total: number; partial: number };

type OpenGoal = { id: string; openedOn: string; horizon: string };

// One day's tally: the commitment slots of goals open that day
// (`openedOn <= d < horizon`) plus the one-off facts whose goal is none or
// open that day. `done` counts the satisfied slots and every such one-off
// fact. `partial` counts the partial slots among those; they never add to
// `done`. Hoy and the Semana both count through here, so they never disagree.
export function tallyDay(input: {
  view: DayView;
  goals: OpenGoal[];
  commitments: { id: string; goalId: string; cadence?: Cadence }[];
  oneOffFacts: { day: string; goalId: string | null }[];
}): DayTally {
  const { view } = input;
  const goalOf = new Map(input.commitments.map((c) => [c.id, c.goalId]));
  // A commitment counted by the week or the month has no daily ask: its own
  // row says «1 de 3 esta semana», so it stays out of «hechos N de M».
  const flexible = new Set(
    input.commitments.filter((c) => c.cadence && isFlexible(c.cadence)).map((c) => c.id),
  );
  const goals = new Map(input.goals.map((g) => [g.id, g]));
  const openOn = (goalId: string): boolean => {
    const goal = goals.get(goalId);
    return goal !== undefined && goal.openedOn <= view.day && view.day < goal.horizon;
  };

  const slots = view.slots.filter((slot) => {
    if (flexible.has(slot.commitmentId)) return false;
    const goalId = goalOf.get(slot.commitmentId);
    return goalId !== undefined && openOn(goalId);
  });
  const oneOffs = input.oneOffFacts.filter(
    (fact) => fact.day === view.day && (fact.goalId === null || openOn(fact.goalId)),
  );
  return {
    day: view.day,
    done: slots.filter((slot) => slot.satisfied).length + oneOffs.length,
    total: slots.length + oneOffs.length,
    partial: slots.filter((slot) => slot.partial).length,
  };
}

// Per day of the week. An archived goal never reaches `goals`, so it counts
// nowhere.
export function tallyDays(week: TallyInput): DayTally[] {
  const goals = week.goals.map((g) => ({
    id: g.id,
    openedOn: civilDateInZone(new Date(g.createdAt)),
    horizon: g.horizon,
  }));
  return week.view.days.map((view) =>
    tallyDay({ view, goals, commitments: week.commitments, oneOffFacts: week.oneOffFacts }),
  );
}
