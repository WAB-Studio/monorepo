import { todayInZone } from "@/lib/zone";

// An archived goal, or one whose horizon is today or behind it: it takes no
// new phase, commitment, month amount or task.
export function isClosed(goal: { horizon: string; archivedAt: Date | string | null }): boolean {
  return goal.archivedAt !== null || goal.horizon <= todayInZone();
}
