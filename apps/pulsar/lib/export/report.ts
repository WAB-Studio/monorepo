import type { ReviewWeek } from "@/lib/day/types";
import type { MonthRow } from "@/lib/plan/months";

export type CarriedReport = {
  name: string;
  from: string;
  owes: number;
  hasAmount: boolean;
  children: { name: string; owes: number; hasAmount: boolean }[];
};

export type GoalReport = {
  id: string;
  name: string;
  horizon: string;
  endedOn: string | null;
  unit: string | null;
  thisMonth: { planned: number | null; reached: number; underPace: boolean };
  toDate: { planned: number; reached: number };
  phases: { aim: string; startsOn: string; endsOn: string; current: boolean }[];
  carried: CarriedReport[];
  months: (MonthRow & { carried: number | null })[];
  weeks: ReviewWeek[];
};

export type Report = {
  today: string;
  evidence: "read" | "unreadable";
  goals: GoalReport[];
};
