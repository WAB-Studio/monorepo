import { civilDateInZone } from "@/lib/zone";
import type { WeekView } from "@/lib/day/types";

// What `tallyDays` reads of `loadWeek`'s answer, spelled structurally so this
// file stays pure and DB-free.
type TallyInput = {
  view: WeekView;
  goals: { id: string; horizon: string; createdAt: string }[];
  commitments: { id: string; goalId: string }[];
  oneOffFacts: { day: string; goalId: string | null }[];
};

export type DayTally = { day: string; done: number; total: number };

// Per day of the week: the commitment slots of goals open that day
// (`openedOn <= d < horizon`) plus the one-off facts whose goal is none or
// open that day. `done` counts the satisfied slots and every such one-off
// fact. An archived goal never reaches `goals`, so it counts nowhere.
export function tallyDays(week: TallyInput): DayTally[] {
  const goalOf = new Map(week.commitments.map((c) => [c.id, c.goalId]));
  const goals = new Map(
    week.goals.map((g) => [g.id, { openedOn: civilDateInZone(new Date(g.createdAt)), horizon: g.horizon }]),
  );
  const openOn = (goalId: string, day: string): boolean => {
    const goal = goals.get(goalId);
    return goal !== undefined && goal.openedOn <= day && day < goal.horizon;
  };

  return week.view.days.map((view) => {
    const slots = view.slots.filter((slot) => {
      const goalId = goalOf.get(slot.commitmentId);
      return goalId !== undefined && openOn(goalId, view.day);
    });
    const oneOffs = week.oneOffFacts.filter(
      (fact) => fact.day === view.day && (fact.goalId === null || openOn(fact.goalId, view.day)),
    );
    return {
      day: view.day,
      done: slots.filter((slot) => slot.satisfied).length + oneOffs.length,
      total: slots.length + oneOffs.length,
    };
  });
}
